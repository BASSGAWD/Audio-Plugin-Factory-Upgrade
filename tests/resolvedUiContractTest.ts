import { AudioPlugin } from "../src/types";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { rectsOverlap } from "../src/utils/guiArchetypes";
import { validateResolvedUiContract } from "../src/utils/semanticUi";
import { buildJuceScaffold } from "../src/utils/portableCodegen";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const cases = [
  "brutal vintage distortion pedal with drive tone and mix",
  "dreamy stereo delay rack with time feedback and mix",
  "clinical parametric EQ with low mid high bands",
];
let sampleContract: NonNullable<AudioPlugin["resolvedUi"]> | undefined;

for (let caseIndex = 0; caseIndex < cases.length; caseIndex++) {
  const prompt = cases[caseIndex];
  const built = buildOfflinePlugin(prompt);
  const source: AudioPlugin = {
    id: `resolved-ui-${caseIndex}`,
    name: built.name,
    category: built.category,
    description: built.description,
    parameters: built.parameters,
    dspFunction: built.dspFunction,
    faustCode: "",
    cppJuceCode: "",
    createdAt: "2025-01-01T00:00:00.000Z",
  };
  const a = runQualityGate(source, { family: built.family, prompt });
  const b = runQualityGate(source, { family: built.family, prompt });
  const contract = a.plugin.resolvedUi!;
  sampleContract ??= contract;

  check(`${built.family}: emits contract v1`, contract?.version === "1.0");
  check(`${built.family}: contract is deterministic`, JSON.stringify(contract) === JSON.stringify(b.plugin.resolvedUi));
  check(`${built.family}: contract validates`, validateResolvedUiContract(contract).length === 0, validateResolvedUiContract(contract).join(", "));
  check(`${built.family}: headline looks invariant`, a.scores.looks >= 97, String(a.scores.looks));
  check(`${built.family}: one contract control per parameter`, contract.controls.length === a.plugin.parameters.length);
  check(`${built.family}: every control has an accessibility label`, contract.controls.every((c) => c.accessibility.label.trim().length > 0));

  let overlaps = 0;
  for (let i = 0; i < contract.controls.length; i++) {
    for (let j = i + 1; j < contract.controls.length; j++) {
      const x = contract.controls[i].bounds, y = contract.controls[j].bounds;
      if (rectsOverlap({ x: x.x, y: x.y, w: x.width, h: x.height }, { x: y.x, y: y.y, w: y.width, h: y.height })) overlaps++;
    }
  }
  check(`${built.family}: controls are in bounds and non-overlapping`, overlaps === 0);

  const cpp = buildJuceScaffold(a.plugin);
  check(`${built.family}: native editor carries parity tokens`,
    cpp.includes(`archetype=${contract.archetype}`) &&
    cpp.includes(`material=${contract.theme.material}`) &&
    cpp.includes(`accent=${contract.theme.accent}`));
  check(`${built.family}: native editor uses contract artboard`,
    cpp.includes(`setSize (${contract.artboard.width}, ${contract.artboard.height})`));
  const adjustable = a.plugin.parameters.filter((p) => p.min !== p.max);
  check(`${built.family}: native bounds and attachments are emitted for every adjustable parameter`,
    adjustable.every((p) => {
      const c = contract.controls.find((x) => x.parameterId === p.id)!;
      return cpp.includes(`setBounds (${c.bounds.x}, ${c.bounds.y}, ${c.bounds.width}, ${c.bounds.height})`) &&
        cpp.includes(`"${p.id}", ui_`);
    }));
}

if (sampleContract) {
  const firstGroup = sampleContract.hierarchy[0];
  const firstId = firstGroup.parameterIds[0];
  const otherRole = firstGroup.role === "primary" ? "secondary" : "primary";
  const malformed = [
    { label: "omitted hierarchy id", contract: { ...sampleContract, hierarchy: sampleContract.hierarchy.map((g, i) => i ? g : { ...g, parameterIds: g.parameterIds.slice(1) }) } },
    { label: "duplicate hierarchy id", contract: { ...sampleContract, hierarchy: sampleContract.hierarchy.map((g, i) => i ? g : { ...g, parameterIds: [...g.parameterIds, firstId] }) } },
    { label: "unknown hierarchy id", contract: { ...sampleContract, hierarchy: sampleContract.hierarchy.map((g, i) => i ? g : { ...g, parameterIds: [...g.parameterIds, "not_a_control"] }) } },
    { label: "role-mismatched hierarchy id", contract: { ...sampleContract, hierarchy: [...sampleContract.hierarchy, { id: "wrong-role", label: "Wrong", role: otherRole, parameterIds: [firstId] }] } },
  ];
  for (const item of malformed) {
    check(`validator rejects ${item.label}`, validateResolvedUiContract(item.contract as any).length > 0);
  }
}

console.log(failures === 0 ? "\nRESOLVED UI CONTRACT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);