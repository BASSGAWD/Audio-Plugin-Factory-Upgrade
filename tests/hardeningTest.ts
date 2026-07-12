import { normalizeModelDspCode } from "../src/utils/healthcheckRunner";
import { parseModelJson } from "../src/utils/llmGateway";
import { measureMusicality, runQualityGate } from "../src/utils/qualityGate";
import { AudioPlugin, PluginParameter } from "../src/types";

let failures = 0;
const check = (label: string, cond: boolean, extra?: string) => {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"} ${label}${extra ? " -- " + extra : ""}`);
};

// --- normalizeModelDspCode ---
const body = `let g = params.gain !== undefined ? params.gain : 0.5;\nreturn Math.tanh(inputSample * (1 + g));`;
check("normalize: plain body untouched", normalizeModelDspCode(body) === body);
check("normalize: strips js fence", normalizeModelDspCode("```javascript\n" + body + "\n```") === body);
check("normalize: strips bare fence", normalizeModelDspCode("```\n" + body + "\n```") === body);
check("normalize: unwraps function decl", normalizeModelDspCode(`function process(inputSample, params, state) {\n${body}\n}`) === body);
check("normalize: unwraps arrow", normalizeModelDspCode(`(inputSample, params, state) => {\n${body}\n}`) === body);
check("normalize: unwraps const fn", normalizeModelDspCode(`const dsp = function(inputSample, params, state) {\n${body}\n};`) === body);
const bodyWithBraces = `if (!state.init) { state.y = 0; state.init = true; }\nreturn inputSample;`;
check("normalize: keeps inner braces intact", normalizeModelDspCode(`function f(a,b,c) {\n${bodyWithBraces}\n}`) === bodyWithBraces);
check("normalize: fence + function combined", normalizeModelDspCode("```js\nfunction f(a,b,c) {\n" + body + "\n}\n```") === body);

// --- parseModelJson ---
check("json: plain", parseModelJson('{"a":1}').a === 1);
check("json: fenced", parseModelJson('```json\n{"a":2}\n```').a === 2);
check("json: chatter around object", parseModelJson('Sure! Here is the plugin:\n{"a":3}\nHope that helps!').a === 3);
let threw = false;
try { parseModelJson("no json here at all"); } catch { threw = true; }
check("json: garbage throws", threw);

// --- extremes instability detection ---
const params: PluginParameter[] = [
  { id: "feedback", name: "Feedback", min: 0, max: 1.0, defaultValue: 0.4, value: 0.4, unit: "ratio" },
];
// Stable at default 0.4, diverges at feedback = 1.0 (integrator grows without bound)
const unstable = `
if (!state.init) { state.y = 0; state.init = true; }
let fb = params.feedback !== undefined ? params.feedback : 0.4;
state.y = inputSample + state.y * (0.6 + fb * 0.5);
return state.y;
`;
const m = measureMusicality(unstable, params);
check("extremes: unstable knob detected", m.unstableParams.includes("feedback") && !m.ok, `unstable=[${m.unstableParams}] evidence="${m.evidence.slice(0, 80)}..."`);

// --- DC blocker decision ---
const dcParams: PluginParameter[] = [
  { id: "bias", name: "Bias", min: 0, max: 0.5, defaultValue: 0.25, value: 0.25, unit: "ratio" },
];
const dcPlugin: AudioPlugin = {
  id: "dc", name: "DC Test", category: "distortion", description: "",
  parameters: dcParams,
  dspFunction: `let b = params.bias !== undefined ? params.bias : 0.25;\nreturn Math.tanh(inputSample + b);`,
  faustCode: "", cppJuceCode: "", createdAt: "",
};
const gate = runQualityGate(dcPlugin);
check("dc: blocker enabled for biased output", gate.plugin.dcBlock === true, `dcBlock=${gate.plugin.dcBlock} musicality=${gate.scores.musicality}`);
check("dc: musicality not penalized once blocked", gate.scores.musicality >= 97, `musicality=${gate.scores.musicality}`);

console.log(failures === 0 ? "\nALL HARDENING TESTS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
