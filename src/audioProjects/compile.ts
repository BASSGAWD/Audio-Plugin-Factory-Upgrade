import type { AudioProjectKind, AudioSoftwareProject, AudioProjectBrief, BriefDecision, CapabilitySummary, CompilationResult, LegacyPlugin, PreviewFidelity, PreviewModel, ProjectControl, ProjectNode, ProjectRoute, ProjectRevision, ProjectCodeAsset, QualityEvidence } from "./contracts";
import { AUDIO_SOFTWARE_PROJECT_VERSION } from "./contracts";
import { classifyAudioSoftwarePrompt } from "./classify";
import { registerAudioProjectCapability } from "./registry";
import { evidence, validateAudioSoftwareProject } from "./validate";

const control = (id: string, label: string, role: ProjectControl["role"], min = 0, max = 1, defaultValue = .5): ProjectControl => ({ id, label, role, min, max, defaultValue });
const stableHash = (value: string) => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return (hash >>> 0).toString(36);
};
const title = (kind: AudioProjectKind) => `${kind[0].toUpperCase()}${kind.slice(1)} Prototype`;
const asset = (kind: AudioProjectKind, source: string): ProjectCodeAsset => ({
  id: `asset-${kind}-browser-model`,
  language: "javascript",
  filename: `${kind}Prototype.js`,
  source,
});
const nativeDspByKind: Partial<Record<AudioProjectKind, { family: "dynamics" | "synthesizer" | "sampler" | "utility"; category: "dynamics" | "synthesizer" | "filter"; source: string }>> = {
  effect: { family: "dynamics", category: "dynamics", source: "return inputSample * (1 - params.mix) + Math.tanh(inputSample * 1.5) * params.mix;" },
  instrument: { family: "synthesizer", category: "synthesizer", source: "return inputSample * params.voice_level;" },
  sampler: { family: "sampler", category: "synthesizer", source: "return inputSample;" },
  mastering: { family: "dynamics", category: "dynamics", source: "const ceiling = Math.pow(10, params.ceiling / 20); const compressed = Math.tanh(inputSample * 0.995 * 1.1); return Math.max(-ceiling, Math.min(ceiling, compressed));" },
  utility: { family: "utility", category: "filter", source: "return inputSample;" },
};
const nativeAsset = (kind: AudioProjectKind, source: string): ProjectCodeAsset => ({
  id: `asset-${kind}-native-dsp`,
  language: "javascript",
  filename: `${kind}NativeDsp.js`,
  source: `export function process(inputSample, params, state) {\n${source}\n}\n`,
});
const sourceByKind: Record<AudioProjectKind, string> = {
  effect: `const defaults = { mix: 0.5 };\nexport const createModel = () => ({ controls: defaults, process(input, controls = defaults) { const wet = Math.tanh(input * 1.5); return input * (1 - controls.mix) + wet * controls.mix; } });\n`,
  instrument: `const contract = { voices: 8, noteRange: [24, 108], voiceLevel: 0.5 };\nexport const createModel = (sampleRate = 48000) => { const voices = new Map(); return { contract, noteOn(note) { if (note >= contract.noteRange[0] && note <= contract.noteRange[1] && voices.size < contract.voices) voices.set(note, 0); }, noteOff(note) { voices.delete(note); }, processFrame(level = contract.voiceLevel) { let output = 0; for (const [note, phase] of voices) { output += Math.sin(phase) * level; voices.set(note, (phase + 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) / sampleRate) % (2 * Math.PI)); } return output / Math.max(1, voices.size); } }; };\n`,
  sampler: `const assets = { "asset-kick": 0.17, "asset-snare": 0.41, "asset-hat": 0.73, "asset-clap": 0.59 };\nconst pads = { 36: "asset-kick", 37: "asset-snare", 38: "asset-hat", 39: "asset-clap" };\nexport const createModel = () => { const active = new Map(); return { assets: Object.keys(assets), pads, triggerPad(midiNote) { const assetId = pads[midiNote]; if (assetId) active.set(assetId, 0); }, processFrame() { let out = 0; for (const [id, phase] of active) { out += Math.sin((phase + 1) * assets[id]) * Math.exp(-phase / 20); if (phase >= 120) active.delete(id); else active.set(id, phase + 1); } return out; } }; };\n`,
  sequencer: `const sequence = { bpm: 120, stepsPerBar: 16, persistenceKey: "audio-project-sequence-v1", events: [{ id: "event-0", step: 0, note: 60, velocity: 0.8, durationSteps: 1 }] };\nexport const createModel = () => ({ sequence, eventsAtStep(step) { return sequence.events.filter(event => event.step === step); }, nextStep(step) { return (step + 1) % sequence.stepsPerBar; }, serialize() { return JSON.stringify(sequence); } });\n`,
  mixer: `const contract = { channels: [{ id: "channel-1", gain: 1, busId: "master" }, { id: "channel-2", gain: 1, busId: "master" }], buses: [{ id: "master", gain: 1 }] };\nexport const createModel = () => ({ contract, mix(inputs, controlGains = {}) { const frames = Math.max(0, ...contract.channels.map(channel => inputs[channel.id]?.length || 0)); const master = (controlGains["master"] ?? contract.buses[0].gain); return Array.from({ length: frames }, (_, frame) => contract.channels.reduce((sum, channel) => sum + (inputs[channel.id]?.[frame] || 0) * (controlGains[channel.id] ?? channel.gain), 0) * master); } });\n`,
  mastering: `const chain = [{ id: "master-eq", type: "eq" }, { id: "master-compressor", type: "compressor" }, { id: "master-limiter", type: "limiter" }];\nexport const createModel = () => ({ chain, process(input, ceilingDb = -1) { const equalized = input * 0.995; const compressed = Math.tanh(equalized * 1.1); const ceiling = 10 ** (ceilingDb / 20); return Math.max(-ceiling, Math.min(ceiling, compressed)); } });\n`,
  utility: `const contract = { sourceNodeId: "node-meter", ballisticsMs: 300, peakHoldMs: 1200 };\nexport const createModel = () => { let peak = 0; let sumSquares = 0; let count = 0; return { contract, observe(sample) { const release = Math.exp(-1 / Math.max(1, contract.ballisticsMs)); peak = Math.max(peak * release, Math.abs(sample)); sumSquares += sample * sample; count++; return { peak, rms: Math.sqrt(sumSquares / count) }; } }; };\n`,
  daw: `const contract = { tracks: 2, buses: [{ id: "master", kind: "master" }, { id: "return-a", kind: "return" }], transportBpm: 120 };\nexport const createModel = () => { const state = { position: 0, playing: false }; return { contract, transport() { return { bpm: contract.transportBpm, position: state.position, playing: state.playing }; }, play() { state.playing = true; return state.playing; }, stop() { state.playing = false; state.position = 0; return state.playing; }, advance(seconds) { if (state.playing) state.position += seconds; return state.position; }, trackCount() { return contract.tracks; } }; };\n`,
};

/** Truthful preview behaviour per kind — never implies compiled/native output. */
const fidelityByKind: Record<AudioProjectKind, PreviewFidelity> = {
  effect: "processor-audition",
  mastering: "processor-audition",
  instrument: "processor-audition",
  daw: "browser-workstation",
  sampler: "focused-simulation",
  sequencer: "focused-simulation",
  mixer: "focused-simulation",
  utility: "focused-simulation",
};
const PREVIEW_COPY: Record<PreviewFidelity, string> = {
  "processor-audition": "You can hear this on a real signal in the browser processor audition.",
  "browser-workstation": "Opens as an arrangement in the browser workstation Studio; it is not a single plugin.",
  "focused-simulation": "Runs as a focused browser simulation of the workflow; there is no live audio audition.",
};

/** Builds the honest what-happened read-out from a project's own facts. */
function buildSummary(kind: AudioProjectKind, goal: string, evidenceList: QualityEvidence[], nativeSupported: boolean, changed: string[]): CapabilitySummary {
  return {
    understood: [`Read as a ${kind} project`, goal ? `Goal in your words: ${goal}` : "No specific goal text supplied; used the category default"],
    changed,
    proven: evidenceList.filter(e => e.pass && (e.grade === "measured" || e.grade === "static")).map(e => `${e.check}: ${e.detail}`),
    conceptual: evidenceList.filter(e => e.grade === "conceptual").map(e => `${e.check}: ${e.detail}`),
    unsupported: nativeSupported
      ? []
      : ["Native VST3 export is not offered for this project kind; the browser model is what ships."],
  };
}

/** Per-kind audience descriptions (plain language for beginner readers). */
const AUDIENCES_BY_KIND: Record<AudioProjectKind, string[]> = {
  effect: ["A mixing or tracking engineer who wants to process audio through a browser plugin", "A musician shaping their sound without installing software"],
  instrument: ["A performer or composer who wants to play MIDI notes through a browser instrument", "A producer building a keyboard or synth starting point"],
  sampler: ["A beatmaker triggering drum hits or one-shots from pads", "A producer who wants to load and play back samples in the browser"],
  sequencer: ["A producer programming patterns without a full DAW", "A musician who wants a loop-based step sequencer to drive MIDI"],
  mixer: ["A producer balancing multiple audio channels in a lightweight browser console", "An engineer who needs a quick gain-staging and routing prototype"],
  mastering: ["A mixing or mastering engineer applying final loudness, EQ, and limiting", "A producer getting a track ready for streaming or download"],
  utility: ["An engineer monitoring signal levels or analyzing audio in real time", "A producer who needs metering without a full plugin chain"],
  daw: ["A songwriter or producer creating full tracks in the browser workstation", "A musician who wants multitrack recording, arrangement, and mixing in one place"],
};

/** Per-kind workflow descriptions (plain language). */
const WORKFLOWS_BY_KIND: Record<AudioProjectKind, string[]> = {
  effect: ["Insert on a channel or bus to process audio through the effect", "Adjust parameters to shape the sound, then audition on a real signal"],
  instrument: ["Connect a MIDI keyboard or use on-screen pads to play notes", "Layer or route into a channel strip for mixing"],
  sampler: ["Load or assign samples to pads, then trigger by MIDI note or mouse click", "Loop, chop, or layer samples to build a kit"],
  sequencer: ["Program a step pattern then play it back at the set tempo", "Route MIDI output to an instrument or sampler in the session"],
  mixer: ["Route audio sources to channels, adjust gain and pan, route to buses", "Use as a gain-staging and routing prototype before a full mixdown"],
  mastering: ["Run a stereo mix through the EQ, compressor, and limiter chain", "Set the ceiling and check loudness before exporting for streaming"],
  utility: ["Insert on a channel to monitor peak and RMS levels in real time", "Use peak-hold to catch transients without interrupting playback"],
  daw: ["Record, arrange, and mix tracks in the browser without installing software", "Export a mix or bounce individual tracks when the session is done"],
};

/** Per-kind plain-language interface description. */
const INTERFACE_DESC_BY_KIND: Record<AudioProjectKind, string> = {
  effect: "A single-channel audio processor with parameter knobs and a dry/wet mix control.",
  instrument: "A polyphonic keyboard instrument with a voice-level knob and MIDI input.",
  sampler: "A bank of trigger pads, each mapped to a sample, with a pad-bank selector.",
  sequencer: "A step grid with a tempo control and playback transport.",
  mixer: "Two input channels and a master bus with individual gain faders.",
  mastering: "An EQ, compressor, and limiter in series with a ceiling control.",
  utility: "A metering display showing peak and RMS levels with configurable ballistics.",
  daw: "A multitrack arrangement with audio tracks, return buses, and a master bus.",
};

/** Per-kind plain-language validation requirements. */
const VALIDATION_REQS_BY_KIND: Record<AudioProjectKind, string[]> = {
  effect: ["The processor must pass audio and apply the effect correctly", "Dry/wet blend must produce a value between the dry and wet signal", "Parameter IDs must be stable so saved presets load correctly"],
  instrument: ["Each MIDI note must produce audio in the declared note range", "Voice count must not exceed the declared polyphony limit", "Note-on and note-off must both work without leaving stuck notes"],
  sampler: ["Every pad must map to a unique sample with a distinct fingerprint", "Triggering a pad must produce audio output", "MIDI note numbers must be unique per pad and within 0–127"],
  sequencer: ["Event steps must fall within the declared bar length", "Tempo must be positive", "Persistence key must be stable so patterns survive a reload"],
  mixer: ["Every channel must route to a declared bus", "Gain values must be finite numbers", "Channels and buses must have unique IDs"],
  mastering: ["Chain must include EQ, compressor, and limiter in that order", "Ceiling must be a finite dB value", "Limiter must prevent output exceeding the ceiling"],
  utility: ["Meter must connect to a declared graph node", "Ballistics and peak-hold times must be positive", "RMS must be non-negative"],
  daw: ["At least one master bus must be declared", "Transport BPM must be positive", "Track count must be at least one"],
};

/** Contextual outcome-focused decisions shown for every project of this kind. */
// Every decision below changes a real contract/runtime/target invariant when
// selected. Metadata-only decisions (that used to only annotate evidence text)
// were removed: a decision that does not change behaviour, structure, or an
// export target is not observable and must not be offered. Each category keeps
// at least one contextual decision.
const DECISIONS_BY_KIND: Record<AudioProjectKind, BriefDecision[]> = {
  effect: [
    // Note: an adapted effect's audition delegates to the loaded generated
    // plugin's faceplate DSP, so a "character" decision that only tweaked the
    // generic browser-model mix would not change what the user actually hears —
    // it was metadata-only and has been removed. The export decision is the
    // effect's real contextual decision (it flips the VST3 target invariant).
    { id: "effect-export", question: "Do you need a VST3 plugin file for your DAW?", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"], selected: "Browser prototype is enough" },
  ],
  instrument: [
    { id: "instrument-polyphony", question: "How many notes can play at once?", options: ["Single note (monophonic)", "Up to 4 notes", "Up to 8 notes"], selected: "Up to 8 notes" },
    { id: "instrument-export", question: "Do you need a VST3 plugin file for your DAW?", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"], selected: "Browser prototype is enough" },
  ],
  sampler: [
    { id: "sampler-pads", question: "How many pads do you need?", options: ["4 pads (basic kit)", "8 pads", "16 pads"], selected: "4 pads (basic kit)" },
  ],
  sequencer: [
    { id: "sequencer-steps", question: "How many steps per bar?", options: ["8 steps", "16 steps", "32 steps"], selected: "16 steps" },
  ],
  mixer: [
    // mixer-buses was removed: the browser source/simulation does not implement
    // return-bus processing, so a bus-count decision would not change any runtime
    // behaviour. mixer-channels is the real contextual mixer decision.
    { id: "mixer-channels", question: "How many input channels do you need to start?", options: ["2 channels", "4 channels", "8 channels"], selected: "2 channels" },
  ],
  mastering: [
    // The mastering model only clamps sample peaks to a dBFS ceiling — it does
    // not measure or target LUFS. The decision reflects exactly that: each option
    // maps to an implemented peak-ceiling value applied by the limiter.
    { id: "mastering-target", question: "What peak ceiling should the limiter enforce?", options: ["Standard (-1 dBFS)", "Conservative (-2 dBFS)", "Hot (-0.3 dBFS)"], selected: "Standard (-1 dBFS)" },
    { id: "mastering-export", question: "Do you need a VST3 plugin file for your DAW?", options: ["Browser prototype is enough", "Yes, scaffold a VST3 for JUCE compilation"], selected: "Browser prototype is enough" },
  ],
  utility: [
    { id: "utility-ballistics", question: "How fast should the meter respond?", options: ["Slow (program-level monitoring)", "Medium", "Fast (transient-catching)"], selected: "Medium" },
  ],
  daw: [
    { id: "daw-tracks", question: "How many tracks do you need to start?", options: ["2 tracks", "4 tracks", "8 tracks"], selected: "2 tracks" },
  ],
};

function brief(prompt: string, kind: AudioProjectKind, controls: ProjectControl[], nodes: ProjectNode[], routes: ProjectRoute[], evidenceCheck: string, nativeSupported: boolean, changed: string[]): AudioProjectBrief {
  const goal = prompt.trim().slice(0, 200);
  const fidelity = fidelityByKind[kind];
  const evidenceList: QualityEvidence[] = [
    // The compiler does NOT execute the browser fixture; it only emits it. So
    // this starts as conceptual/pending, not measured. It is promoted to
    // "measured" only after the fixture is actually run and validated (the
    // browser audition / a harness execution reports the real result).
    evidence("conceptual", evidenceCheck, "Golden model fixture emitted but not yet executed — run the browser audition to measure it against its declared contract."),
    // "stable links" IS genuinely verified at compile time: the compiler runs
    // validateAudioSoftwareProject over the emitted references, so this remains
    // a truthful static check.
    evidence("static", "stable links", "Control, route, asset, and event references passed contract validation."),
    evidence("conceptual", "preview truth", PREVIEW_COPY[fidelity]),
    evidence("conceptual", "target truth", nativeSupported ? "VST3 support requires native export; this compilation emits only the browser model, not a compiled binary." : "No native plugin target is claimed for this project kind."),
  ];
  const platformTargets = [
    "Browser — ready now (runs without installation)",
    nativeSupported
      ? "VST3 — scaffold available (requires JUCE compilation, not a compiled binary)"
      : "VST3 — not offered for this project kind",
  ];
  const interfaceRoles = Object.fromEntries(controls.map(c => [c.id, c.role]));
  return {
    purpose: prompt.slice(0, 240) || "Audio software",
    goal,
    audiences: AUDIENCES_BY_KIND[kind],
    workflows: WORKFLOWS_BY_KIND[kind],
    interfaceDescription: INTERFACE_DESC_BY_KIND[kind],
    interfaceRoles,
    platformTargets,
    validationRequirements: VALIDATION_REQS_BY_KIND[kind],
    decisions: DECISIONS_BY_KIND[kind].map(d => ({ ...d })),
    controls,
    uiRoles: interfaceRoles,
    graph: { nodes, routes },
    targets: [
      { target: "browser", supported: true, stage: "emitted" },
      nativeSupported
        ? { target: "vst3", supported: true, stage: "exportable", limitation: "Export through the validated audio-project native scaffold, then run the JUCE compile stage. This emits a scaffold, not a compiled binary." }
        : { target: "vst3", supported: false, stage: "unsupported", limitation: "This workflow project is not represented as a VST3 plugin." },
    ],
    evidence: evidenceList,
    summary: buildSummary(kind, goal, evidenceList, nativeSupported, changed),
  };
}
export function compileAudioSoftwareProject(prompt: string, legacyPlugin?: LegacyPlugin): CompilationResult {
  const classification = classifyAudioSoftwarePrompt(prompt);
  const kind = classification.kind;
  const projectId = `audio-project-${kind}-${stableHash(prompt.trim().toLowerCase())}`;
  const modelByKind: Record<AudioProjectKind, PreviewModel> = {
    effect: "audio-processor", instrument: "polyphonic-instrument", sampler: "sample-pad-bank",
    sequencer: "step-sequencer", mixer: "multi-bus-mixer", mastering: "mastering-chain", utility: "meter",
    daw: "browser-workstation",
  };
  // Anything the compiler defaulted or adjusted that the requester should know.
  const changed: string[] = [];
  if (classification.ambiguous) changed.push(`Category was ambiguous; defaulted to ${kind} (revisable without losing evidence)`);
  if (classification.matched.length === 0 && classification.confidence < 0.45) changed.push("No explicit category term matched; inferred a starting point from your goal");
  const browserAsset = asset(kind, sourceByKind[kind]);
  const common = (controls: ProjectControl[], nodes: ProjectNode[], routes: ProjectRoute[], check: string, nativeSupported: boolean) => {
    const nativeDefinition = nativeSupported ? nativeDspByKind[kind] : undefined;
    const dspAsset = nativeDefinition ? nativeAsset(kind, nativeDefinition.source) : undefined;
    return ({
    version: AUDIO_SOFTWARE_PROJECT_VERSION,
    id: projectId,
    kind,
    name: title(kind),
    brief: brief(prompt, kind, controls, nodes, routes, check, nativeSupported, changed),
    preview: { runtime: "browser" as const, model: modelByKind[kind], fidelity: fidelityByKind[kind], entryAssetId: browserAsset.id, entryExport: "createModel" as const },
    codeAssets: dspAsset ? [browserAsset, dspAsset] : [browserAsset],
    native: nativeDefinition && dspAsset ? { dspAssetId: dspAsset.id, family: nativeDefinition.family, category: nativeDefinition.category } : undefined,
    limitations: [nativeSupported ? "This stage emits a runnable browser model; native output requires /api/audio-projects/native/scaffold and the JUCE compile stage. No compiled binary is produced here." : "Runnable browser model only; this project kind has no truthful VST3 target."],
    repairHistory: [],
    });
  };
  let project: AudioSoftwareProject;
  if (kind === "instrument") {
    const nodes = [{ id: "node-midi", type: "midi-input", label: "MIDI Input" }, { id: "node-voices", type: "polyphonic-voices", label: "Voice Engine" }, { id: "node-output", type: "audio-output", label: "Output" }];
    project = { ...common([control("voice_level", "Voice Level", "primary")], nodes, [{ id: "route-midi-voices", from: "node-midi", to: "node-voices", gain: 1 }, { id: "route-voices-output", from: "node-voices", to: "node-output", gain: 1 }], "note pitch mapping", true), kind: "instrument", midi: { input: "midi-note", output: "audio", voices: 8, noteRange: [24, 108] } };
  } else if (kind === "sampler") {
    const assets = ["kick", "snare", "hat", "clap"].map((name, i) => ({ id: `asset-${name}`, name, distinctFingerprint: `fixture-${i}-${name}` }));
    const nodes = [{ id: "node-pads", type: "midi-pad-input", label: "Pads" }, { id: "node-sampler", type: "sample-voices", label: "Sampler" }, { id: "node-output", type: "audio-output", label: "Output" }];
    project = { ...common([control("pad_bank", "Pad Bank", "performance")], nodes, [{ id: "route-pads-sampler", from: "node-pads", to: "node-sampler", gain: 1 }, { id: "route-sampler-output", from: "node-sampler", to: "node-output", gain: 1 }], "sample distinctness", false), kind: "sampler", pads: assets.map((sampleAsset, i) => ({ id: `pad-${i + 1}`, midiNote: 36 + i, assetId: sampleAsset.id })), assets };
  } else if (kind === "sequencer") {
    const nodes = [{ id: "node-transport", type: "transport", label: "Transport" }, { id: "node-events", type: "event-sequence", label: "Sequence" }, { id: "node-midi-output", type: "midi-output", label: "MIDI Output" }];
    project = { ...common([control("tempo", "Tempo", "transport", 40, 240, 120)], nodes, [{ id: "route-transport-events", from: "node-transport", to: "node-events", gain: 1 }, { id: "route-events-output", from: "node-events", to: "node-midi-output", gain: 1 }], "sequencer event timing", false), kind: "sequencer", sequence: { bpm: 120, stepsPerBar: 16, persistenceKey: `${projectId}-sequence-v1`, events: [{ id: "event-0", step: 0, note: 60, velocity: .8, durationSteps: 1 }] } };
  } else if (kind === "mixer") {
    const nodes = [{ id: "channel-1", type: "audio-channel", label: "Channel 1" }, { id: "channel-2", type: "audio-channel", label: "Channel 2" }, { id: "master", type: "audio-bus", label: "Master Bus" }, { id: "node-output", type: "audio-output", label: "Output" }];
    project = { ...common([control("channel-1-gain", "Channel 1 Gain", "primary"), control("channel-2-gain", "Channel 2 Gain", "primary"), control("master-gain", "Master Gain", "routing")], nodes, [{ id: "route-channel-1-master", from: "channel-1", to: "master", gain: 1 }, { id: "route-channel-2-master", from: "channel-2", to: "master", gain: 1 }, { id: "route-master-output", from: "master", to: "node-output", gain: 1 }], "mixer channel isolation and gain", false), kind: "mixer", mixer: { channels: [{ id: "channel-1", gain: 1, busId: "master" }, { id: "channel-2", gain: 1, busId: "master" }], buses: [{ id: "master", gain: 1 }] } };
  } else if (kind === "mastering") {
    const nodes = [{ id: "node-input", type: "audio-input", label: "Input" }, { id: "master-eq", type: "eq", label: "EQ" }, { id: "master-compressor", type: "compressor", label: "Compressor" }, { id: "master-limiter", type: "limiter", label: "Limiter" }, { id: "node-output", type: "audio-output", label: "Output" }];
    project = { ...common([control("ceiling", "Ceiling", "primary", -12, 0, -1)], nodes, [{ id: "route-input-eq", from: "node-input", to: "master-eq", gain: 1 }, { id: "route-eq-compressor", from: "master-eq", to: "master-compressor", gain: 1 }, { id: "route-compressor-limiter", from: "master-compressor", to: "master-limiter", gain: 1 }, { id: "route-limiter-output", from: "master-limiter", to: "node-output", gain: 1 }], "mastering chain ordering", true), kind: "mastering", chain: [{ id: "master-eq", type: "eq", enabled: true }, { id: "master-compressor", type: "compressor", enabled: true }, { id: "master-limiter", type: "limiter", enabled: true }] };
  } else if (kind === "utility") {
    const nodes = [{ id: "node-input", type: "audio-input", label: "Input" }, { id: "node-meter", type: "meter", label: "Meter" }];
    project = { ...common([control("meter_range", "Meter Range", "meter", -96, 0, -18)], nodes, [{ id: "route-input-meter", from: "node-input", to: "node-meter", gain: 1 }], "utility meter connection", false), kind: "utility", analyzer: { type: "meter", sourceNodeId: "node-meter", ballisticsMs: 300, peakHoldMs: 1200 } };
  } else if (kind === "daw") {
    const nodes = [{ id: "track-1", type: "audio-track", label: "Audio 1" }, { id: "track-2", type: "audio-track", label: "Audio 2" }, { id: "return-a", type: "return-bus", label: "Return A" }, { id: "master", type: "master-bus", label: "Master" }];
    project = { ...common([control("transport_bpm", "Tempo", "transport", 40, 240, 120), control("master-gain", "Master Gain", "routing")], nodes, [{ id: "route-track-1-master", from: "track-1", to: "master", gain: 1 }, { id: "route-track-2-master", from: "track-2", to: "master", gain: 1 }, { id: "route-return-master", from: "return-a", to: "master", gain: 1 }], "workstation transport and routing", false), kind: "daw", workstation: { tracks: 2, buses: [{ id: "master", kind: "master" }, { id: "return-a", kind: "return" }], transportBpm: 120 } };
  } else {
    const nodes = [{ id: "node-input", type: "audio-input", label: "Input" }, { id: "node-processor", type: "effect", label: "Processor" }, { id: "node-output", type: "audio-output", label: "Output" }];
    const controls = legacyPlugin?.parameters.length ? legacyPlugin.parameters.map(parameter => control(parameter.id, parameter.name, "primary", parameter.min, parameter.max, parameter.defaultValue)) : [control("mix", "Mix", "primary")];
    if (legacyPlugin) {
      const legacyAsset: ProjectCodeAsset = { id: "asset-effect-legacy-dsp", language: "javascript", filename: "legacyProcessor.js", source: `export function process(inputSample, params, state) {\n${legacyPlugin.dspFunction}\n}\n` };
      project = { ...common(controls, nodes, [{ id: "route-input-processor", from: "node-input", to: "node-processor", gain: 1 }, { id: "route-processor-output", from: "node-processor", to: "node-output", gain: 1 }], "processor signal path", true), kind: "effect", codeAssets: [browserAsset, legacyAsset], native: { dspAssetId: legacyAsset.id, family: "dynamics", category: "dynamics" }, processor: { mode: "adapted-plugin", pluginId: legacyPlugin.id, parameters: legacyPlugin.parameters.map(p => p.id), dspAssetId: legacyAsset.id } };
    } else {
      const nativeDspAsset = common(controls, nodes, [], "processor signal path", true).native!.dspAssetId;
      project = { ...common(controls, nodes, [{ id: "route-input-processor", from: "node-input", to: "node-processor", gain: 1 }, { id: "route-processor-output", from: "node-processor", to: "node-output", gain: 1 }], "processor signal path", true), kind: "effect", processor: { mode: "native-model", parameters: ["mix"], dspAssetId: nativeDspAsset } };
    }
  }
  // For the exportable kinds, the default export decision is "Browser prototype
  // is enough", so the initial vst3 target must reflect not-selected (rather
  // than defaulting to an exportable scaffold that the requester never asked
  // for). Selecting the VST3 export decision later restores the scaffold target.
  if (kind === "effect" || kind === "instrument" || kind === "mastering") {
    const exportDecision = project.brief.decisions.find(d => d.id === `${kind}-export`);
    if (exportDecision) applyExportTargetDecision(project, exportDecision.selected);
  }
  const checked = validateAudioSoftwareProject(project);
  if (!checked.valid) throw new Error(`Compiler emitted invalid project: ${checked.issues.join("; ")}`);
  return { project, classification, adaptedLegacyPlugin: kind === "effect" && !!legacyPlugin };
}

/**
 * Revises a project's category while keeping the same project id.
 *
 * Evidence provenance rule:
 * - Prior measured/static evidence is NOT carried into the new category's
 *   "proven" list (it was proven for the old kind, not the new one).
 * - It is preserved as conceptual provenance history so it is not silently
 *   lost; it appears in `summary.conceptual` as "from prior [kind] build".
 * - The new category gets its own fresh evidence from its own compilation.
 * - The original project id is kept so any persisted references stay coherent.
 */
export function reviseAudioSoftwareProject(
  previous: AudioSoftwareProject,
  toKind: AudioProjectKind,
  legacyPlugin?: LegacyPlugin,
): { result: CompilationResult; revision: ProjectRevision } {
  const preservedEvidence = previous.brief.evidence.filter(e => e.pass && (e.grade === "measured" || e.grade === "static"));
  // Re-run the compiler for the new category, seeded with the original goal so
  // the plain-language intent survives the category change.
  const goal = previous.brief.goal || previous.brief.purpose;
  const seededPrompt = `${KIND_PROMPT_SEED[toKind]} ${goal}`.trim();
  const result = compileAudioSoftwareProject(seededPrompt, toKind === "effect" ? legacyPlugin : undefined);
  const revision: ProjectRevision = {
    fromKind: previous.kind,
    toKind,
    reason: `Requester revised category from ${previous.kind} to ${toKind}`,
    preservedEvidence,
  };
  // Keep the original project id so any persisted references remain coherent.
  (result.project as { id: string }).id = previous.id;
  result.project.brief.summary.understood.unshift(`Revised from a ${previous.kind} project`);
  // Prior evidence becomes conceptual provenance — not proven for the new kind.
  if (preservedEvidence.length) {
    result.project.brief.summary.conceptual.push(
      ...preservedEvidence.map(e => `Provenance from prior ${previous.kind} build — ${e.check}: ${e.detail}`),
    );
  }
  result.project.repairHistory = [
    ...result.project.repairHistory,
    revision.reason,
    `Prior ${previous.kind} evidence preserved as conceptual provenance (not proven for new ${toKind} category).`,
  ];
  const checked = validateAudioSoftwareProject(result.project);
  if (!checked.valid) throw new Error(`Revision produced invalid project: ${checked.issues.join("; ")}`);
  return { result, revision };
}

/**
 * Updates a single brief decision's selected answer and applies the
 * corresponding structural/behavioral change to the type-specific contract.
 *
 * Every structural runtime choice (polyphony, pad count, step count, channel
 * count, BPM target, ballistics, track count, etc.) is applied to the project's
 * own contract field — not just stored as metadata. A new static validation
 * evidence item confirms the change. Old measured/static evidence items for the
 * same check are marked stale (moved to conceptual) before the new one is added.
 *
 * The project id and all other validated evidence are preserved.
 * Returns a cloned project so callers can compare by reference.
 */
/**
 * Applies a VST3 export decision to a project's actual export target. When the
 * requester wants a VST3, the vst3 target becomes an exportable scaffold target
 * and the platform list + summary advertise it. When the browser prototype is
 * enough, the vst3 target is set to unsupported/not-selected, the scaffold is
 * hidden, and the platform list says browser-only. This is an observable target
 * invariant — the effect/instrument/mastering card's "Create VST3 scaffold"
 * action is enabled only when the vst3 target is supported+exportable.
 */
function applyExportTargetDecision(project: AudioSoftwareProject, selected: string): void {
  const wantsVst3 = /^yes\b/i.test(selected);
  const brief = project.brief;
  brief.targets = brief.targets.map(t =>
    t.target === "vst3"
      ? wantsVst3
        ? { target: "vst3" as const, supported: true, stage: "exportable" as const, limitation: "Export through the validated audio-project native scaffold, then run the JUCE compile stage. This emits a scaffold, not a compiled binary." }
        : { target: "vst3" as const, supported: false, stage: "unsupported" as const, limitation: "VST3 export not selected — the browser prototype is what ships. Choose the VST3 option to enable the scaffold." }
      : t,
  );
  brief.platformTargets = [
    "Browser — ready now (runs without installation)",
    wantsVst3
      ? "VST3 — scaffold available (requires JUCE compilation, not a compiled binary)"
      : "VST3 — not selected (browser prototype only)",
  ];
  // Reflect the target choice in the capability summary so the read-out stays
  // truthful. Remove any prior export summary line before adding the new one.
  const exportLine = wantsVst3
    ? "VST3 export: scaffold target enabled (requires JUCE compile stage; not a compiled binary)."
    : "VST3 export: not selected — browser prototype only.";
  // Keep summary.unsupported truthful: when the VST3 target is not selected the
  // validator requires the read-out to say so; when it is selected we drop the
  // export-related unsupported line. We only touch export-related entries.
  const isExportUnsupportedLine = (entry: string) => /native|vst3|export/i.test(entry);
  const unsupportedBase = brief.summary.unsupported.filter(entry => !isExportUnsupportedLine(entry));
  brief.summary = {
    ...brief.summary,
    changed: [
      ...brief.summary.changed.filter(c => !/^VST3 export:/.test(c)),
      exportLine,
    ],
    unsupported: wantsVst3
      ? unsupportedBase
      : [...unsupportedBase, "Native VST3 export is not selected; the browser model is what ships. Choose the VST3 export option to enable a scaffold target."],
  };
}

export function updateBriefDecision(
  project: AudioSoftwareProject,
  decisionId: string,
  selected: string,
): AudioSoftwareProject {
  if (!project.brief.decisions.some(d => d.id === decisionId)) {
    throw new Error(`Decision id "${decisionId}" not found in this project's brief`);
  }
  const decisions = project.brief.decisions.map(d =>
    d.id === decisionId ? { ...d, selected } : d,
  );

  // --- Apply structural/behavioral changes to the type-specific contract ----
  // We deep-clone to avoid mutating the original.
  let updated = structuredClone(project) as AudioSoftwareProject;
  updated.brief.decisions = decisions;

  // Helper: add a static validation evidence item for a contract change,
  // demoting any prior evidence with the same check to conceptual (stale).
  const applyEvidence = (check: string, detail: string) => {
    updated.brief.evidence = [
      ...updated.brief.evidence.map(e =>
        e.check === check && (e.grade === "measured" || e.grade === "static")
          ? { ...e, grade: "conceptual" as const, detail: `[stale after decision change] ${e.detail}` }
          : e,
      ),
      { grade: "static" as const, check, detail, pass: true },
    ];
  };

  // Per-decision structural changes -------------------------------------------
  if (decisionId === "instrument-polyphony" && updated.kind === "instrument") {
    const voices =
      selected === "Single note (monophonic)" ? 1
      : selected === "Up to 4 notes" ? 4
      : 8; // "Up to 8 notes" default
    (updated as typeof updated & { midi: { voices: number } }).midi.voices = voices;
    // Regenerate the browser source to reflect the contract change.
    const src = `const contract = { voices: ${voices}, noteRange: [24, 108], voiceLevel: 0.5 };\nexport const createModel = (sampleRate = 48000) => { const voices = new Map(); return { contract, noteOn(note) { if (note >= contract.noteRange[0] && note <= contract.noteRange[1] && voices.size < contract.voices) voices.set(note, 0); }, noteOff(note) { voices.delete(note); }, processFrame(level = contract.voiceLevel) { let output = 0; for (const [note, phase] of voices) { output += Math.sin(phase) * level; voices.set(note, (phase + 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) / sampleRate) % (2 * Math.PI)); } return output / Math.max(1, voices.size); } }; };\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-instrument-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("instrument polyphony", `Instrument polyphony updated to ${voices} voice(s) per decision.`);
  }

  if (decisionId === "sampler-pads" && updated.kind === "sampler") {
    const padCount =
      selected === "4 pads (basic kit)" ? 4
      : selected === "8 pads" ? 8
      : 16; // "16 pads"
    const PAD_NAMES = ["kick", "snare", "hat", "clap", "tom-hi", "tom-mid", "tom-lo", "ride", "crash", "open-hat", "perc-1", "perc-2", "fx-1", "fx-2", "fx-3", "fx-4"];
    const newAssets = Array.from({ length: padCount }, (_, i) => ({
      id: `asset-${PAD_NAMES[i] ?? `pad-${i}`}`,
      name: PAD_NAMES[i] ?? `pad-${i}`,
      distinctFingerprint: `fixture-${i}-${PAD_NAMES[i] ?? `pad-${i}`}`,
    }));
    const newPads = newAssets.map((a, i) => ({ id: `pad-${i + 1}`, midiNote: 36 + i, assetId: a.id }));
    (updated as typeof updated & { pads: typeof newPads; assets: typeof newAssets }).pads = newPads;
    (updated as typeof updated & { assets: typeof newAssets }).assets = newAssets;
    // Rebuild graph nodes for all pads (remove old dynamic pad nodes, keep structural ones).
    updated.brief.graph.nodes = updated.brief.graph.nodes.filter(n => n.type !== "midi-pad-input" && n.id !== "node-pads" && n.id !== "node-sampler" && n.id !== "node-output");
    updated.brief.graph.nodes.push(
      { id: "node-pads", type: "midi-pad-input", label: `${padCount}-pad Bank` },
      { id: "node-sampler", type: "sample-voices", label: "Sampler" },
      { id: "node-output", type: "audio-output", label: "Output" },
    );
    // Regenerate browser source for the new pad count.
    const padEntries = newAssets.map((a, i) => `${36 + i}: "${a.id}"`).join(", ");
    const assetEntries = newAssets.map(a => `"${a.id}": ${0.1 + (newAssets.indexOf(a) * 0.09)}`).join(", ");
    const src = `const assets = { ${assetEntries} };\nconst pads = { ${padEntries} };\nexport const createModel = () => { const active = new Map(); return { assets: Object.keys(assets), pads, triggerPad(midiNote) { const assetId = pads[midiNote]; if (assetId) active.set(assetId, 0); }, processFrame() { let out = 0; for (const [id, phase] of active) { out += Math.sin((phase + 1) * assets[id]) * Math.exp(-phase / 20); if (phase >= 120) active.delete(id); else active.set(id, phase + 1); } return out; } }; };\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-sampler-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("sampler pad count", `Sampler pad count updated to ${padCount} pads per decision.`);
  }

  if (decisionId === "sequencer-steps" && updated.kind === "sequencer") {
    const stepsPerBar =
      selected === "8 steps" ? 8
      : selected === "32 steps" ? 32
      : 16; // "16 steps" default
    (updated as typeof updated & { sequence: { stepsPerBar: number } }).sequence.stepsPerBar = stepsPerBar;
    // Validate existing events still fall within new step count.
    const seq = (updated as typeof updated & { sequence: { events: Array<{ step: number }> } }).sequence;
    seq.events = seq.events.filter(e => e.step < stepsPerBar);
    // Regenerate browser source for the new step count.
    const src = `const sequence = { bpm: 120, stepsPerBar: ${stepsPerBar}, persistenceKey: "${updated.id}-sequence-v1", events: [{ id: "event-0", step: 0, note: 60, velocity: 0.8, durationSteps: 1 }] };\nexport const createModel = () => ({ sequence, eventsAtStep(step) { return sequence.events.filter(event => event.step === step); }, nextStep(step) { return (step + 1) % sequence.stepsPerBar; }, serialize() { return JSON.stringify(sequence); } });\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-sequencer-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("sequencer step count", `Step count updated to ${stepsPerBar} steps per bar per decision.`);
  }

  if (decisionId === "mixer-channels" && updated.kind === "mixer") {
    const channelCount =
      selected === "2 channels" ? 2
      : selected === "4 channels" ? 4
      : 8; // "8 channels"
    const mixer = (updated as typeof updated & { mixer: { channels: Array<{ id: string; gain: number; busId: string }>; buses: Array<{ id: string; gain: number }> } }).mixer;
    mixer.channels = Array.from({ length: channelCount }, (_, i) => ({ id: `channel-${i + 1}`, gain: 1, busId: "master" }));
    // Rebuild graph channel nodes.
    updated.brief.graph.nodes = updated.brief.graph.nodes.filter(n => n.type !== "audio-channel");
    mixer.channels.forEach((ch, i) => {
      updated.brief.graph.nodes.push({ id: ch.id, type: "audio-channel", label: `Channel ${i + 1}` });
    });
    // Rebuild graph routes for channels.
    updated.brief.graph.routes = [
      ...updated.brief.graph.routes.filter(r => !r.id.startsWith("route-channel-")),
      ...mixer.channels.map(ch => ({ id: `route-${ch.id}-master`, from: ch.id, to: "master", gain: 1 })),
    ];
    // Rebuild browser source.
    const channelDefs = mixer.channels.map(ch => `{ id: "${ch.id}", gain: 1, busId: "master" }`).join(", ");
    const src = `const contract = { channels: [${channelDefs}], buses: [{ id: "master", gain: 1 }] };\nexport const createModel = () => ({ contract, mix(inputs, controlGains = {}) { const frames = Math.max(0, ...contract.channels.map(channel => inputs[channel.id]?.length || 0)); const master = (controlGains["master"] ?? contract.buses[0].gain); return Array.from({ length: frames }, (_, frame) => contract.channels.reduce((sum, channel) => sum + (inputs[channel.id]?.[frame] || 0) * (controlGains[channel.id] ?? channel.gain), 0) * master); } });\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-mixer-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("mixer channel count", `Mixer updated to ${channelCount} input channels per decision.`);
  }

  if (decisionId === "mastering-target" && updated.kind === "mastering") {
    // The limiter clamps sample peaks to a dBFS ceiling; each option maps to an
    // exact implemented ceiling value. No LUFS measurement or targeting exists.
    const ceiling =
      selected === "Conservative (-2 dBFS)" ? -2
      : selected === "Hot (-0.3 dBFS)" ? -0.3
      : -1; // "Standard (-1 dBFS)"
    // Update the ceiling control default.
    updated.brief.controls = updated.brief.controls.map(c =>
      c.id === "ceiling" ? { ...c, defaultValue: ceiling } : c,
    );
    // Regenerate browser source with the new ceiling.
    const src = `const chain = [{ id: "master-eq", type: "eq" }, { id: "master-compressor", type: "compressor" }, { id: "master-limiter", type: "limiter" }];\nexport const createModel = () => ({ chain, process(input, ceilingDb = ${ceiling}) { const equalized = input * 0.995; const compressed = Math.tanh(equalized * 1.1); const ceiling = 10 ** (ceilingDb / 20); return Math.max(-ceiling, Math.min(ceiling, compressed)); } });\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-mastering-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("mastering ceiling", `Limiter peak ceiling set to ${ceiling} dBFS per decision: ${selected}.`);
  }

  if (decisionId === "utility-ballistics" && updated.kind === "utility") {
    const ballisticsMs =
      selected === "Slow (program-level monitoring)" ? 800
      : selected === "Fast (transient-catching)" ? 50
      : 300; // "Medium"
    (updated as typeof updated & { analyzer: { ballisticsMs: number } }).analyzer.ballisticsMs = ballisticsMs;
    // Regenerate browser source with new ballistics.
    const src = `const contract = { sourceNodeId: "node-meter", ballisticsMs: ${ballisticsMs}, peakHoldMs: 1200 };\nexport const createModel = () => { let peak = 0; let sumSquares = 0; let count = 0; return { contract, observe(sample) { const release = Math.exp(-1 / Math.max(1, contract.ballisticsMs)); peak = Math.max(peak * release, Math.abs(sample)); sumSquares += sample * sample; count++; return { peak, rms: Math.sqrt(sumSquares / count) }; } }; };\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-utility-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("utility ballistics", `Meter ballistics updated to ${ballisticsMs}ms per decision (${selected}).`);
  }

  if (decisionId === "daw-tracks" && updated.kind === "daw") {
    const trackCount =
      selected === "4 tracks" ? 4
      : selected === "8 tracks" ? 8
      : 2; // "2 tracks"
    (updated as typeof updated & { workstation: { tracks: number } }).workstation.tracks = trackCount;
    // Rebuild graph track nodes.
    updated.brief.graph.nodes = updated.brief.graph.nodes.filter(n => n.type !== "audio-track");
    const trackNodes = Array.from({ length: trackCount }, (_, i) => ({
      id: `track-${i + 1}`, type: "audio-track", label: `Audio ${i + 1}`,
    }));
    updated.brief.graph.nodes.push(...trackNodes);
    // Rebuild graph routes for tracks.
    updated.brief.graph.routes = [
      ...updated.brief.graph.routes.filter(r => !r.id.startsWith("route-track-")),
      ...trackNodes.map(t => ({ id: `route-${t.id}-master`, from: t.id, to: "master", gain: 1 })),
    ];
    // Regenerate browser source for the new track count.
    const src = `const contract = { tracks: ${trackCount}, buses: [{ id: "master", kind: "master" }, { id: "return-a", kind: "return" }], transportBpm: 120 };\nexport const createModel = () => { const state = { position: 0, playing: false }; return { contract, transport() { return { bpm: contract.transportBpm, position: state.position, playing: state.playing }; }, play() { state.playing = true; return state.playing; }, stop() { state.playing = false; state.position = 0; return state.playing; }, advance(seconds) { if (state.playing) state.position += seconds; return state.position; }, trackCount() { return contract.tracks; } }; };\n`;
    const assetIdx = updated.codeAssets.findIndex(a => a.id === `asset-daw-browser-model`);
    if (assetIdx >= 0) updated.codeAssets[assetIdx] = { ...updated.codeAssets[assetIdx], source: src };
    applyEvidence("DAW track count", `DAW starting track count updated to ${trackCount} per decision.`);
  }

  // VST3 export decisions (effect / instrument / mastering) flip the actual
  // vst3 export target between an exportable scaffold target and an
  // unsupported/not-selected target. This is a real, observable target
  // invariant change — the card's scaffold action is gated on it.
  if ((decisionId === "effect-export" || decisionId === "instrument-export" || decisionId === "mastering-export")
    && (updated.kind === "effect" || updated.kind === "instrument" || updated.kind === "mastering")) {
    applyExportTargetDecision(updated, selected);
  }

  // Update the summary.changed log.
  updated.brief.summary = {
    ...updated.brief.summary,
    changed: [
      ...updated.brief.summary.changed.filter(c => !c.startsWith(`Decision "${decisionId}"`)),
      `Decision "${decisionId}" updated to: ${selected}`,
    ],
    proven: updated.brief.evidence
      .filter(e => e.pass && (e.grade === "measured" || e.grade === "static"))
      .map(e => `${e.check}: ${e.detail}`),
    conceptual: updated.brief.evidence
      .filter(e => e.grade === "conceptual")
      .map(e => `${e.check}: ${e.detail}`),
  };

  updated.repairHistory = [...updated.repairHistory, `Brief decision "${decisionId}" set to "${selected}"`];

  const checked = validateAudioSoftwareProject(updated);
  if (!checked.valid) throw new Error(`Decision update produced invalid project: ${checked.issues.join("; ")}`);
  return updated;
}

/**
 * Promotes the golden-fixture evidence item from conceptual/pending to
 * "measured" AFTER the fixture has actually been executed and validated by a
 * caller (the browser audition or a test harness). The compiler never calls
 * this itself, so a freshly compiled project truthfully reports the fixture as
 * emitted-but-not-executed. Callers that really ran the model call this with the
 * measured detail to record the honest result.
 *
 * Returns a new project (the input is not mutated). If no matching pending
 * evidence item exists, the project is returned unchanged.
 */
/** Marker embedded in the pending (conceptual) golden-fixture evidence detail
 *  at compile time. Executors match on this to find the item to promote. */
export const PENDING_FIXTURE_MARKER = "not yet executed";

/**
 * Returns the `check` string of the project's pending (conceptual, un-executed)
 * golden-fixture evidence item, or undefined if there is none (e.g. already
 * promoted to measured). Callers pass this to promoteMeasuredEvidence after a
 * successful execution.
 */
export function findPendingFixtureCheck(project: AudioSoftwareProject): string | undefined {
  return project.brief.evidence.find(
    e => e.grade === "conceptual" && e.detail.includes(PENDING_FIXTURE_MARKER),
  )?.check;
}

export function promoteMeasuredEvidence(
  project: AudioSoftwareProject,
  check: string,
  measuredDetail: string,
): AudioSoftwareProject {
  const next = structuredClone(project) as AudioSoftwareProject;
  let promoted = false;
  next.brief.evidence = next.brief.evidence.map(e => {
    if (!promoted && e.check === check && e.grade === "conceptual") {
      promoted = true;
      return { ...e, grade: "measured" as const, detail: measuredDetail, pass: true };
    }
    return e;
  });
  if (!promoted) return project;
  next.brief.summary = {
    ...next.brief.summary,
    proven: next.brief.evidence
      .filter(e => e.pass && (e.grade === "measured" || e.grade === "static"))
      .map(e => `${e.check}: ${e.detail}`),
    conceptual: next.brief.evidence
      .filter(e => e.grade === "conceptual")
      .map(e => `${e.check}: ${e.detail}`),
  };
  next.repairHistory = [...next.repairHistory, `Fixture "${check}" executed and promoted to measured`];
  return next;
}

const KIND_PROMPT_SEED: Record<AudioProjectKind, string> = {
  effect: "Build an audio effect processor for:",
  instrument: "Build a MIDI instrument synthesizer for:",
  sampler: "Build a drum pad sampler for:",
  sequencer: "Build a step sequencer for:",
  mixer: "Build a channel mixer console for:",
  mastering: "Build a mastering chain for:",
  utility: "Build an audio meter utility for:",
  daw: "Build a multitrack DAW workstation for:",
};

// Default capabilities are deliberately small and replaceable by consumers.
for (const kind of ["effect", "instrument", "sampler", "sequencer", "mixer", "mastering", "utility", "daw"] as AudioProjectKind[]) {
  registerAudioProjectCapability(kind, { plan: project => [`Validate ${project.kind}`, "Present browser prototype"], emit: project => project.codeAssets[0].source, preview: () => ({ runnable: true, entry: "createModel" }), validate: project => validateAudioSoftwareProject(project).issues });
}