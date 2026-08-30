/**
 * audioProjectDispatchTest.ts
 *
 * Verifies the prompt-dispatch classification rule that prevents non-effect
 * goals from entering the legacy plugin-generation path.
 *
 * The guard in handleSendPromptDirectly is:
 *   isEffectPath = kind === "effect"
 *               && !ambiguous
 *               && confidence >= 0.45
 *
 * This test suite exercises every branch of that rule with real prompts so
 * that any future change to classify.ts that inadvertently routes a DAW /
 * mixer / mastering / etc. prompt into the effect path is caught immediately.
 */

import assert from "node:assert/strict";
import { classifyAudioSoftwarePrompt, type AudioProjectKind } from "../src/audioProjects";

/** Mirror of the guard in handleSendPromptDirectly. */
function isEffectPath(prompt: string): boolean {
  const c = classifyAudioSoftwarePrompt(prompt);
  return (
    c.kind === "effect" &&
    !c.ambiguous &&
    c.confidence >= 0.45
  );
}

// ── Effect prompts → must take the effect path ────────────────────────────
const effectPrompts = [
  "Build a warm tape echo delay with wobble and a dry/wet mix control",
  "Make a chorus effect processor",
  "Create a distortion plugin with drive and tone controls",
  "Build a reverb effect with size and mix knobs",
];
for (const prompt of effectPrompts) {
  assert.equal(isEffectPath(prompt), true, `Effect prompt should use effect path: "${prompt}"`);
  assert.equal(classifyAudioSoftwarePrompt(prompt).kind, "effect", `Effect prompt should classify as effect: "${prompt}"`);
}

// ── Non-effect prompts → must NOT take the effect path ────────────────────
const nonEffectCases: Array<{ kind: AudioProjectKind; prompts: string[] }> = [
  {
    kind: "daw",
    prompts: [
      "Build a multitrack DAW workstation with audio tracks and a master bus",
      "Build a full song with multitrack recording and arrangement",
    ],
  },
  {
    kind: "mixer",
    prompts: [
      "Build a four-channel mixer console with gain faders and a master bus",
      "Build a console mixer with buses",
    ],
  },
  {
    kind: "mastering",
    prompts: [
      "Build a mastering limiter chain ready for streaming",
      "Build a mastering chain with EQ, compressor, and limiter",
    ],
  },
  {
    kind: "instrument",
    prompts: [
      "Build a MIDI instrument synthesizer",
      "Build a polyphonic MIDI synth I can play from a keyboard",
    ],
  },
  {
    kind: "sampler",
    prompts: [
      "Build an MPC drum pad sampler",
      "Build a drum pad sampler with eight pads",
    ],
  },
  {
    kind: "sequencer",
    prompts: [
      "Build a sixteen step sequencer",
      "Build a step sequencer to program a beat at an adjustable tempo",
    ],
  },
  {
    kind: "utility",
    prompts: [
      "Build an audio meter utility",
      "Build a peak and RMS audio meter with configurable ballistics",
    ],
  },
];

for (const { kind, prompts } of nonEffectCases) {
  for (const prompt of prompts) {
    const classification = classifyAudioSoftwarePrompt(prompt);
    assert.equal(
      classification.kind,
      kind,
      `"${prompt}" should classify as ${kind}, got ${classification.kind}`,
    );
    assert.equal(
      isEffectPath(prompt),
      false,
      `Non-effect prompt (${kind}) must not take the effect/plugin path: "${prompt}"`,
    );
  }
}

// ── Vague / unreadable prompts stay in neutral project intake ─────────────
const vaguePrompts = [
  "do the thing please",
  "make something good",
  "I need something for my music",
];
for (const prompt of vaguePrompts) {
  const c = classifyAudioSoftwarePrompt(prompt);
  assert.ok(
    c.confidence < 0.45,
    `Vague prompt should have confidence < 0.45, got ${c.confidence}: "${prompt}"`,
  );
  assert.equal(
    isEffectPath(prompt),
    false,
    `Vague prompt must stay out of the effect/plugin path until user clarifies: "${prompt}"`,
  );
}

// ── Ambiguous prompts stay in neutral project intake ───────────────────────
// "a mixer that is also a mastering limiter chain" is ambiguous and should
// never enter the effect path before the user confirms a category.
const mixerMasteringAmbiguous = classifyAudioSoftwarePrompt(
  "Build a mixer that is also a mastering limiter chain",
);
assert.equal(mixerMasteringAmbiguous.ambiguous, true, "mixer+mastering prompt should be ambiguous");
assert.equal(
  mixerMasteringAmbiguous.alternatives.some(a => a.kind === "effect"),
  false,
  "mixer+mastering alternatives should not include effect",
);
assert.equal(
  isEffectPath("Build a mixer that is also a mastering limiter chain"),
  false,
  "A mixer/mastering ambiguity must not route to the effect/plugin path",
);

// ── Classification confidence invariants ──────────────────────────────────
// Clear non-effect prompts should still classify with useful confidence.
for (const { kind, prompts } of nonEffectCases) {
  for (const prompt of prompts) {
    const c = classifyAudioSoftwarePrompt(prompt);
    assert.ok(
      c.confidence >= 0.45,
      `Non-effect prompt (${kind}) must have confidence >= 0.45: "${prompt}" (got ${c.confidence})`,
    );
  }
}

// ── Classify + dispatch is pure (no side effects) ─────────────────────────
// Running the classifier twice on the same prompt must return the same kind.
const stablePrompts = [
  ...effectPrompts,
  ...nonEffectCases.flatMap(c => c.prompts),
];
for (const prompt of stablePrompts) {
  const a = classifyAudioSoftwarePrompt(prompt);
  const b = classifyAudioSoftwarePrompt(prompt);
  assert.equal(a.kind, b.kind, `Classifier must be deterministic for: "${prompt}"`);
  assert.equal(a.ambiguous, b.ambiguous, `Ambiguity flag must be stable for: "${prompt}"`);
}

console.log("audio project dispatch tests passed");
