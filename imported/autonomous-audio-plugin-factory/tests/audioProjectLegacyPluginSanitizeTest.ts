import assert from "node:assert/strict";
import { sanitizeLegacyPlugin, validateAudioProjectGenerationBody } from "../server/audioProjectGeneration";

// --- Valid passthrough ---------------------------------------------------
{
  const clean = sanitizeLegacyPlugin({
    id: "plugin-echo",
    name: "Echo",
    parameters: [
      { id: "time_ms", name: "Time", min: 0, max: 1000, defaultValue: 120, value: 120, unit: "ms" },
      { id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.4, value: 0.4, unit: "" },
    ],
    dspFunction: "return inputSample;",
  });
  assert.ok(clean, "A well-formed plugin must sanitize successfully");
  assert.equal(clean!.id, "plugin-echo");
  assert.equal(clean!.name, "Echo");
  assert.equal(clean!.parameters.length, 2);
  assert.deepEqual(clean!.parameters.map(p => p.id), ["time_ms", "mix"]);
  assert.equal(clean!.dspFunction, "return inputSample;");
}

// --- defaultValue falls back to value then min ---------------------------
{
  const clean = sanitizeLegacyPlugin({
    id: "p", name: "P",
    parameters: [{ id: "a", name: "A", min: 2, max: 10, value: 7 }],
    dspFunction: "return inputSample;",
  });
  assert.ok(clean);
  assert.equal(clean!.parameters[0].defaultValue, 7, "defaultValue should fall back to value");
}

// --- Rejections: return undefined, never throw ---------------------------
const rejections: Array<[string, unknown]> = [
  ["null", null],
  ["non-object", "nope"],
  ["missing id", { name: "X", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["missing name", { id: "x", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["missing dsp", { id: "x", name: "X", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }] }],
  ["oversized id", { id: "x".repeat(201), name: "X", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["oversized dsp", { id: "x", name: "X", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }], dspFunction: "z".repeat(200_001) }],
  ["parameters not array", { id: "x", name: "X", parameters: "no", dspFunction: "x" }],
  ["too many parameters", { id: "x", name: "X", parameters: Array.from({ length: 65 }, (_, i) => ({ id: `p${i}`, name: `P${i}`, min: 0, max: 1, defaultValue: 0 })), dspFunction: "x" }],
  ["empty parameters", { id: "x", name: "X", parameters: [], dspFunction: "x" }],
  ["duplicate param id", { id: "x", name: "X", parameters: [{ id: "a", name: "A", min: 0, max: 1, defaultValue: 0 }, { id: "a", name: "B", min: 0, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["oversized param id", { id: "x", name: "X", parameters: [{ id: "a".repeat(121), name: "A", min: 0, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["non-finite min", { id: "x", name: "X", parameters: [{ id: "a", name: "A", min: Infinity, max: 1, defaultValue: 0 }], dspFunction: "x" }],
  ["NaN max", { id: "x", name: "X", parameters: [{ id: "a", name: "A", min: 0, max: "not-a-number", defaultValue: 0 }], dspFunction: "x" }],
  ["malformed param", { id: "x", name: "X", parameters: [null], dspFunction: "x" }],
];
for (const [label, payload] of rejections) {
  let result: unknown;
  assert.doesNotThrow(() => { result = sanitizeLegacyPlugin(payload); }, `sanitizeLegacyPlugin("${label}") must not throw`);
  assert.equal(result, undefined, `sanitizeLegacyPlugin("${label}") must return undefined`);
}

// --- Body validation attaches sanitized plugin, drops malformed ----------
{
  const withPlugin = validateAudioProjectGenerationBody({
    prompt: "Build an echo effect",
    legacyPlugin: { id: "p", name: "P", parameters: [{ id: "mix", name: "Mix", min: 0, max: 1, defaultValue: 0.5 }], dspFunction: "return inputSample;" },
  });
  assert.ok(withPlugin.legacyPlugin, "Body must carry the sanitized plugin");
  assert.equal(withPlugin.legacyPlugin!.id, "p");

  const malformed = validateAudioProjectGenerationBody({
    prompt: "Build an echo effect",
    legacyPlugin: { id: "p" }, // missing name/dsp/params
  });
  assert.equal(malformed.legacyPlugin, undefined, "Malformed plugin must be dropped, not fail the request");

  assert.throws(
    () => validateAudioProjectGenerationBody({ legacyPlugin: {} }),
    /prompt is required/i,
    "Missing prompt must still throw",
  );
}

console.log("audio project legacy plugin sanitize tests passed");
