import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { runQualityGate } from "../src/utils/qualityGate";
import { generateLookAndFeelCpp, generateLookAndFeelHeader, generatePluginEditorCpp, getCompletedBuildArtifact, validateNativePlugin } from "../server/nativeBuild";
import { scaffoldNativeProject } from "../server/nativeBuild";
import { resolveSemanticUiContract } from "../src/utils/semanticUi";
import { repairResolvedGeometry } from "../src/utils/semanticUi";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failures = 0;
const check = (label: string, ok: boolean) => { if (!ok) failures++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
const build = buildOfflinePlugin("clinical delay with time feedback mix");
const gated = runQualityGate({
  id: "native-ui", name: build.name, category: build.category, description: build.description,
  parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "",
}, { family: build.family, prompt: "clinical delay with time feedback mix" }).plugin;
const native = {
  name: gated.name, category: gated.category, attributes: gated.buildReport?.attributes,
  parameters: gated.parameters, dspFunction: gated.dspFunction, customSkin: gated.customSkin, resolvedUi: gated.resolvedUi!,
};

try { validateNativePlugin(native); check("server accepts a gated resolved UI contract", true); } catch { check("server accepts a gated resolved UI contract", false); }
const unregisteredDir = fs.mkdtempSync(path.join(os.tmpdir(), "unregistered-vst3-"));
const unregisteredArtifact = path.join(unregisteredDir, "Valid.vst3");
fs.mkdirSync(unregisteredArtifact);
check("server rejects a valid artifact path used in place of a build id", getCompletedBuildArtifact(unregisteredArtifact) === undefined);
fs.rmSync(unregisteredDir, { recursive: true, force: true });
const editor = generatePluginEditorCpp("Parity", native.parameters, native.customSkin, native.category, native.attributes, native.resolvedUi);
check("production editor uses exact contract artboard", editor.includes(`setSize (${native.resolvedUi.artboard.width}, ${native.resolvedUi.artboard.height})`));
check("production editor emits exact contract bounds", native.resolvedUi.controls.every((c) => editor.includes(`(${c.bounds.x}, ${c.bounds.y}, ${c.bounds.width}, ${c.bounds.height})`)));
check("production editor renders hierarchy labels and control accessibility names", native.resolvedUi.hierarchy.every((g) => editor.includes(`"${g.label}"`)) && native.resolvedUi.controls.every((c) => editor.includes(`"${c.accessibility.label}"`)));
check("production editor does not use legacy grid for contract plugins", !editor.includes("const int columns ="));

for (const bad of [
  { ...native, parameters: [{ ...native.parameters[0], id: 'x"); system("bad"); //' }, ...native.parameters.slice(1)] },
  { ...native, customSkin: { ...native.customSkin, accentColor: "red; injected" } },
  { ...native, resolvedUi: { ...native.resolvedUi, controls: native.resolvedUi.controls.map((c, i) => i ? c : { ...c, bounds: { ...c.bounds, x: -4 } }) } },
  { ...native, parameters: native.parameters.map((p, i) => i ? p : { ...p, controlType: "select", choices: ["A", "B"] }) },
  { ...native, resolvedUi: { ...native.resolvedUi, controls: native.resolvedUi.controls.map((c, i) => i ? c : { ...c, controlType: "toggle" }) } },
]) {
  let rejected = false;
  try { validateNativePlugin(bad as any); } catch { rejected = true; }
  check("server rejects adversarial native UI input", rejected);
}

const styleControls = native.resolvedUi.controls.map((c, i) =>
  i === 0 ? { ...c, style: { accent: "#12ab34", font: "mono" as const } } :
  i === 1 ? { ...c, style: { accent: "#a1b2c3", font: "serif" as const } } : c
);
const styleEditor = generatePluginEditorCpp("StyleParity", native.parameters, native.customSkin, native.category, native.attributes, { ...native.resolvedUi, controls: styleControls });
const lookHeader = generateLookAndFeelHeader();
const lookCpp = generateLookAndFeelCpp(["modern_pointer"], "#12ab34");
check("production editor consumes distinct per-control accent and font tokens",
  styleEditor.includes("ff12ab34") && styleEditor.includes("ffa1b2c3") &&
  styleEditor.includes('"uiFont", "mono"') && styleEditor.includes('"uiFont", "serif"') &&
  styleEditor.includes('"Courier New"') && styleEditor.includes('"Times New Roman"'));
check("rotary knob applies rotary fill/outline/thumb colour IDs", styleEditor.includes("RotaryHorizontalVerticalDrag") && styleEditor.includes("rotarySliderFillColourId") && styleEditor.includes("rotarySliderOutlineColourId") && styleEditor.includes("thumbColourId"));
check("linear slider applies track/background/thumb colour IDs", styleEditor.includes("LinearHorizontal") && styleEditor.includes("trackColourId") && styleEditor.includes("backgroundColourId") && styleEditor.includes("thumbColourId"));
check("resolved fonts drive actual slider label, ComboBox and popup painting", lookHeader.includes("getLabelFont") && lookHeader.includes("getComboBoxFont") && lookHeader.includes("getPopupMenuFont") && lookCpp.includes("juce::Font (typefaceName"));

// Source-level behavior regression: APVTS's declared type must agree with
// the widget/attachment type, not merely look correct in an editor string.
const discreteParams = [
  { id: "mode", name: 'Mode "A"', min: 0, max: 2, defaultValue: 1, unit: 'ms"; //', controlType: "select", choices: ["Clean", 'Lead "Bright"', "Modern"] },
  { id: "enabled", name: "Enabled\nswitch", min: 0, max: 1, defaultValue: 1, unit: "", controlType: "toggle" },
  { id: "pad_1", name: "Pad", min: 0, max: 1, defaultValue: 0, unit: "", controlType: "pad" },
];
const discreteBase: any = { name: 'evil"); # injected', category: "delay", parameters: repairResolvedGeometry(discreteParams as any).parameters, dspFunction: "return inputSample;", customSkin: { bgColor: "#101010", accentColor: "#ff0000", textColor: "#ffffff" } };
discreteBase.resolvedUi = resolveSemanticUiContract(discreteBase);
const discrete = await scaffoldNativeProject(discreteBase, { provider: "ollama", ollamaUrl: "http://127.0.0.1:1", ollamaModel: "none", lmStudioUrl: "", lmStudioModel: "" });
const processor = fs.readFileSync(`${discrete.projectDir}/Source/PluginProcessor.cpp`, "utf8");
const discreteEditor = fs.readFileSync(`${discrete.projectDir}/Source/PluginEditor.cpp`, "utf8");
check("select declares AudioParameterChoice and ComboBox choices/attachment", processor.includes("AudioParameterChoice") && discreteEditor.includes('addItem ("Clean", 1)') && discreteEditor.includes("ComboBoxAttachment"));
check("toggle and pad declare AudioParameterBool and ButtonAttachment", (processor.match(/AudioParameterBool/g) || []).length === 2 && (discreteEditor.match(/ButtonAttachment/g) || []).length >= 2);
check("toggle applies tick/text colours and paints text with resolved font", discreteEditor.includes("ToggleButton::tickColourId") && discreteEditor.includes("ToggleButton::textColourId") && lookCpp.includes("drawToggleButton") && lookCpp.includes("g.setFont (juce::Font (typefaceName"));
check("combo applies background/outline/text/arrow colours and resolved LookAndFeel", ["backgroundColourId", "outlineColourId", "textColourId", "arrowColourId"].every((id) => discreteEditor.includes(`ComboBox::${id}`)) && discreteEditor.includes("combo->setLookAndFeel (controlLaf)"));
check("malicious names and units remain escaped C++ literals", !processor.includes('Mode "A"') && processor.includes('Mode \\"A\\"') && !discreteEditor.includes('ms"; //'));
check("malicious plugin name becomes no executable CMake/source token", !fs.readFileSync(`${discrete.projectDir}/CMakeLists.txt`, "utf8").includes('evil");'));
fs.rmSync(discrete.projectDir, { recursive: true, force: true });

console.log(failures ? `\n${failures} FAILURE(S)` : "\nNATIVE UI SECURITY: ALL CHECKS PASS");
process.exit(failures ? 1 : 0);