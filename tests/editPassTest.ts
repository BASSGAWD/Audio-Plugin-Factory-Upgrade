/**
 * Edit-by-default + annotation edits: after the first build, prompts and
 * pinned notes modify the LOADED plugin in place instead of regenerating it.
 * Every original parameter id must survive every edit path, and no edit may
 * ship below the >= 97 floor. Full regeneration is a routing decision, proven
 * here via classifyEditIntent.
 */
import { classifyEditIntent } from "../src/utils/editIntent";
import {
  runEditPass,
  applyNoteEdits,
  pickAdditionStage,
  chainStage,
  ElementNote,
  EditWorker,
} from "../src/utils/editPass";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

function gated(prompt: string): AudioPlugin {
  const b = buildOfflinePlugin(prompt);
  const plugin: AudioPlugin = {
    id: "t", name: b.name, category: b.category, description: b.description,
    parameters: b.parameters, dspFunction: b.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
  };
  return runQualityGate(plugin, { family: b.family, prompt }).plugin;
}

const hasIds = (plugin: AudioPlugin, ids: string[]) => ids.every((id) => plugin.parameters.some((p) => p.id === id));
const minScore = (g: { scores: { looks: number; performance: number; latency: number; musicality: number } }) =>
  Math.min(g.scores.looks, g.scores.performance, g.scores.latency, g.scores.musicality);

(async () => {
  /* 1. Intent routing: edit vs rebuild vs none */
  check("intent: no plugin loaded -> none (first build regenerates)", classifyEditIntent("make a warm delay", { hasPlugin: false }) === "none");
  check("intent: 'start over' -> rebuild", classifyEditIntent("start over", { hasPlugin: true }) === "rebuild");
  check("intent: 'from scratch' -> rebuild", classifyEditIntent("build it again from scratch", { hasPlugin: true }) === "rebuild");
  check("intent: 'make me a compressor' -> rebuild (new family)", classifyEditIntent("make me a compressor", { hasPlugin: true }) === "rebuild");
  check("intent: 'make it brighter' -> edit (not a new thing)", classifyEditIntent("make it brighter", { hasPlugin: true }) === "edit");
  check("intent: 'add a ring mod' -> edit", classifyEditIntent("add a ring mod", { hasPlugin: true }) === "edit");
  check("intent: a question -> none", classifyEditIntent("what does the feedback knob do?", { hasPlugin: true }) === "none");
  check("intent: pinned notes force edit", classifyEditIntent("apply", { hasPlugin: true, noteCount: 2 }) === "edit");

  /* 2. Note edits: rename / raise / lower / widen / narrow / leftover */
  const params = (): PluginParameter[] => [
    { id: "drive", name: "Drive", min: 0, max: 24, defaultValue: 8, value: 8, unit: "dB" },
    { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.5, value: 0.5, unit: "" },
  ];
  const p1 = params();
  const r1 = applyNoteEdits(p1, [{ paramId: "mix", paramName: "Mix", note: "rename to Blend" }]);
  check("note: rename applies", r1.changes.length === 1 && p1.find((p) => p.id === "mix")!.name === "Blend");
  const p2 = params();
  applyNoteEdits(p2, [{ paramId: "drive", paramName: "Drive", note: "too subtle, give it more" }]);
  check("note: 'more' raises the value", p2.find((p) => p.id === "drive")!.defaultValue > 8);
  const p3 = params();
  applyNoteEdits(p3, [{ paramId: "drive", paramName: "Drive", note: "way too aggressive, less please" }]);
  check("note: 'less/too aggressive' lowers the value", p3.find((p) => p.id === "drive")!.defaultValue < 8);
  const p4 = params();
  applyNoteEdits(p4, [{ paramId: "mix", paramName: "Mix", note: "needs a wider range" }]);
  check("note: 'wider range' extends max", p4.find((p) => p.id === "mix")!.max > 1);
  const p5 = params();
  applyNoteEdits(p5, [{ paramId: "drive", paramName: "Drive", note: "range is too wide" }]);
  check("note: 'too wide' tightens max", p5.find((p) => p.id === "drive")!.max < 24);
  const p6 = params();
  const r6 = applyNoteEdits(p6, [{ paramId: "drive", paramName: "Drive", note: "make it sparkle somehow" }]);
  check("note: unmappable note is reported as leftover", r6.leftovers.length === 1 && r6.changes.length === 0);

  /* 3. Additive chaining keeps the original algorithm + params, still gates */
  const delay = buildOfflinePlugin("make a tape delay");
  const originalIds = delay.parameters.map((p) => p.id);
  const stage = pickAdditionStage("add a ring mod");
  check("chain: a ring-mod addition is recognized", !!stage, stage?.id);
  const chained = chainStage(delay.dspFunction, stage!, new Set(originalIds));
  check("chain: the existing DSP wraps cleanly", !!chained);
  if (chained) {
    const candidate: AudioPlugin = {
      id: "c", name: delay.name, category: delay.category, description: "",
      parameters: [...delay.parameters.map((p) => ({ ...p, value: p.defaultValue })), ...chained.addedParams],
      dspFunction: chained.body, faustCode: "", cppJuceCode: "", createdAt: "",
    };
    const g = runQualityGate(candidate, { family: delay.family, prompt: "delay with ring mod" });
    check("chain: composed plugin compiles", g.report.compiled);
    check("chain: every original control survives", hasIds(g.plugin, originalIds));
    check("chain: the added control is present", g.plugin.parameters.some((p) => p.id === "ringfreq"));
  }

  /* 4. runEditPass: deterministic voicing tweak edits in place, keeps ids */
  const drive = gated("make a warm drive");
  const driveIds = drive.parameters.map((p) => p.id);
  const tweak = await runEditPass(drive, { prompt: "make it brighter and dirtier", editWorker: null });
  check("editpass: a voicing tweak produced changes", tweak.changes.length > 0, tweak.changes.join("; "));
  check("editpass: every original control survives a tweak", hasIds(tweak.plugin, driveIds));
  check("editpass: tweak result still clears the >= 97 floor", minScore(tweak.gate) >= 97, `min=${minScore(tweak.gate)}`);
  check("editpass: DSP code is unchanged by a pure voicing tweak", tweak.plugin.dspFunction === drive.dspFunction);

  /* 5. runEditPass: element notes rename + revoice the loaded plugin */
  const notes: ElementNote[] = [
    { paramId: driveIds.includes("tone") ? "tone" : driveIds[0], paramName: "Tone", note: "rename to Color" },
    { paramId: "drive", paramName: "Drive", note: "too subtle, more" },
  ];
  const noteEdit = await runEditPass(drive, { prompt: "Apply my element notes", notes, editWorker: null });
  check("editpass: notes renamed a control", noteEdit.plugin.parameters.some((p) => p.name === "Color"), noteEdit.changes.join("; "));
  check("editpass: notes kept every original id", hasIds(noteEdit.plugin, driveIds));

  /* 6. Model edit agent: accepted only when it keeps every id AND clears the gate */
  const goodWorker: EditWorker = async () => ({
    dspFunction: `if(!state.init){state.lp=0;state.smD=8;state.init=true;}
let drive=params.drive!==undefined?params.drive:8;
let tone=params.tone!==undefined?params.tone:4500;
let mix=params.mix!==undefined?params.mix:1;
let grit=params.grit!==undefined?params.grit:0.4;
state.smD+=0.002*(drive-state.smD);
let g=Math.pow(10,state.smD/20);
let mid=0.5*((state.pv||0)+inputSample); state.pv=inputSample;
let wet=0.5*(Math.tanh(mid*g*(1+grit))+Math.tanh(inputSample*g*(1+grit)))/Math.pow(g,0.65);
let a=1-Math.exp(-2*Math.PI*tone/44100);
state.lp+=a*(wet-state.lp);
return Math.tanh(inputSample*(1-mix)+state.lp*mix);`,
    newParameters: [{ id: "grit", name: "Grit", min: 0, max: 1, defaultValue: 0.4, value: 0.4, unit: "" }],
    notes: "added a grit control that intensifies the drive",
  });
  const modelEdit = await runEditPass(drive, {
    prompt: "give it a more expensive, gritty character",
    notes: [{ paramId: "drive", paramName: "Drive", note: "make this feel more boutique" }],
    editWorker: goodWorker,
  });
  check("editpass: a valid model edit is applied", modelEdit.usedModel, modelEdit.unhandled.join("; "));
  check("editpass: model edit added its new control", modelEdit.plugin.parameters.some((p) => p.id === "grit"));
  check("editpass: model edit kept every original id", hasIds(modelEdit.plugin, driveIds));

  /* 7. Hostile model edit: drops controls (they go dead) -> rejected, original kept */
  const hostileWorker: EditWorker = async () => ({
    dspFunction: `let drive=params.drive!==undefined?params.drive:8;
return Math.tanh(inputSample*Math.pow(10,drive/20))*0.2;`, // ignores tone AND mix -> both dead
    notes: "trust me",
  });
  const before = drive.dspFunction;
  const hostile = await runEditPass(drive, {
    prompt: "make it fancier",
    notes: [{ paramId: "drive", paramName: "Drive", note: "unmappable freeform request here" }],
    editWorker: hostileWorker,
  });
  check("editpass: hostile model edit is rejected", !hostile.usedModel && hostile.unhandled.length > 0, hostile.unhandled.join("; "));
  check("editpass: rejected edit leaves the original DSP intact", hostile.plugin.dspFunction === before);
  check("editpass: rejected edit keeps every original id", hasIds(hostile.plugin, driveIds));

  console.log(failures === 0 ? "\nEDIT PASS: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
