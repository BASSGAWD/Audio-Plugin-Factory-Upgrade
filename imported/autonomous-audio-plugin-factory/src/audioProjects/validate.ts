import { AUDIO_SOFTWARE_PROJECT_VERSION, type AudioSoftwareProject, type QualityEvidence } from "./contracts";
// QualityEvidence is used by the migration + evidence helpers below.

export interface ProjectValidation { valid: boolean; issues: string[]; }
const ids = (values: { id: string }[]) => new Set(values.map(value => value.id));
export function validateAudioSoftwareProject(project: AudioSoftwareProject): ProjectValidation {
  const issues: string[] = [];
  if (!project || typeof project !== "object") return { valid: false, issues: ["Project must be an object"] };
  if (!["effect", "instrument", "sampler", "sequencer", "mixer", "mastering", "utility", "daw"].includes(project.kind)) return { valid: false, issues: ["Unsupported project kind"] };
  if (project.version !== AUDIO_SOFTWARE_PROJECT_VERSION) issues.push("Unsupported project version");
  if (typeof project.id !== "string" || !project.id || typeof project.name !== "string" || !project.name) issues.push("Project requires stable id and name");
  if (!project.brief || !Array.isArray(project.brief.controls) || !project.brief.graph || !Array.isArray(project.brief.graph.nodes) || !Array.isArray(project.brief.graph.routes) || !Array.isArray(project.brief.targets) || !Array.isArray(project.brief.evidence)) {
    return { valid: false, issues: [...issues, "Project brief shape is invalid"] };
  }
  if (typeof project.brief.goal !== "string") issues.push("Project brief requires a plain-language goal string");
  // Explicit brief fields (v1.1+)
  if (!Array.isArray(project.brief.audiences) || project.brief.audiences.some(a => typeof a !== "string") || project.brief.audiences.length === 0) issues.push("Project brief requires a non-empty audiences array of strings");
  if (!Array.isArray(project.brief.workflows) || project.brief.workflows.some(w => typeof w !== "string") || project.brief.workflows.length === 0) issues.push("Project brief requires a non-empty workflows array of strings");
  if (typeof project.brief.interfaceDescription !== "string" || !project.brief.interfaceDescription) issues.push("Project brief requires a non-empty interfaceDescription string");
  if (!project.brief.interfaceRoles || typeof project.brief.interfaceRoles !== "object") issues.push("Project brief requires an interfaceRoles object");
  if (!Array.isArray(project.brief.platformTargets) || project.brief.platformTargets.some(t => typeof t !== "string") || project.brief.platformTargets.length === 0) issues.push("Project brief requires a non-empty platformTargets array of strings");
  if (!Array.isArray(project.brief.validationRequirements) || project.brief.validationRequirements.some(r => typeof r !== "string") || project.brief.validationRequirements.length === 0) issues.push("Project brief requires a non-empty validationRequirements array of strings");
  if (!Array.isArray(project.brief.decisions) || project.brief.decisions.some(d => typeof d.id !== "string" || typeof d.question !== "string" || !Array.isArray(d.options) || d.options.some((o: unknown) => typeof o !== "string") || typeof d.selected !== "string" || !d.options.includes(d.selected))) issues.push("Project brief decisions must have id, question, options, and a selected value that matches an option");
  const summary = project.brief.summary;
  if (!summary || (["understood", "changed", "proven", "conceptual", "unsupported"] as const).some(key => !Array.isArray(summary[key]) || summary[key].some(value => typeof value !== "string"))) {
    issues.push("Project brief requires a capability summary of string arrays");
  }
  if (!project.preview || !["processor-audition", "browser-workstation", "focused-simulation"].includes(project.preview.fidelity)) issues.push("Preview must declare a truthful fidelity");
  if (!Array.isArray(project.codeAssets) || !project.preview || !Array.isArray(project.limitations) || !Array.isArray(project.repairHistory)) {
    return { valid: false, issues: [...issues, "Project output metadata is invalid"] };
  }
  if (!project.limitations.every(value => typeof value === "string") || !project.repairHistory.every(value => typeof value === "string")) issues.push("Limitations and repair history must contain strings");
  const controls = ids(project.brief.controls);
  if (controls.size !== project.brief.controls.length) issues.push("Control IDs must be unique");
  if (project.brief.controls.some(control => !control.id || !control.label || !control.role || (control.min !== undefined && !Number.isFinite(control.min)) || (control.max !== undefined && !Number.isFinite(control.max)) || (control.defaultValue !== undefined && !Number.isFinite(control.defaultValue)))) issues.push("Controls require valid stable metadata");
  for (const id of Object.keys(project.brief.uiRoles)) if (!controls.has(id)) issues.push(`UI role references missing control ${id}`);
  const nodes = ids(project.brief.graph.nodes);
  if (nodes.size !== project.brief.graph.nodes.length || project.brief.graph.nodes.some(node => !node.id || !node.type || !node.label)) issues.push("Graph node IDs and metadata must be unique and complete");
  const routes = ids(project.brief.graph.routes);
  if (routes.size !== project.brief.graph.routes.length) issues.push("Route IDs must be unique");
  for (const route of project.brief.graph.routes) if (!route.id || !nodes.has(route.from) || !nodes.has(route.to) || !Number.isFinite(route.gain)) issues.push(`Invalid route ${route.id || "without id"}`);
  const codeAssets = ids(project.codeAssets);
  if (codeAssets.size !== project.codeAssets.length || project.codeAssets.some(asset => !asset.id || !asset.filename || !asset.source || !["typescript", "javascript"].includes(asset.language))) issues.push("Code assets require unique IDs and runnable source metadata");
  if (project.preview.runtime !== "browser" || project.preview.entryExport !== "createModel" || !codeAssets.has(project.preview.entryAssetId)) issues.push("Preview must reference a runnable browser code asset");
  const targets = project.brief.targets.map(target => target.target);
  if (new Set(targets).size !== targets.length || !project.brief.targets.some(target => target.target === "browser" && target.supported && target.stage === "emitted")) issues.push("Targets must uniquely declare an emitted browser preview");
  if ((project.kind === "sequencer" || project.kind === "mixer" || project.kind === "sampler" || project.kind === "utility" || project.kind === "daw") && project.brief.targets.some(target => target.target === "vst3" && target.supported)) issues.push(`${project.kind} cannot claim VST3 support`);
  // Preview fidelity must be truthful for the kind — no processor audition for a
  // workflow-only project, and the DAW must map to the browser workstation.
  const expectedFidelity: Record<string, string> = {
    effect: "processor-audition", mastering: "processor-audition", instrument: "processor-audition",
    daw: "browser-workstation",
    sampler: "focused-simulation", sequencer: "focused-simulation", mixer: "focused-simulation", utility: "focused-simulation",
  };
  if (project.preview && expectedFidelity[project.kind] && project.preview.fidelity !== expectedFidelity[project.kind]) issues.push(`${project.kind} preview fidelity must be ${expectedFidelity[project.kind]}`);
  // Truthfulness of the capability summary: a project with no native VST3 target
  // must say so in "unsupported", and must never claim a compiled/native export.
  const vst3Supported = project.brief.targets.some(target => target.target === "vst3" && target.supported);
  if (summary && !vst3Supported && !summary.unsupported.some(entry => /native|vst3|export/i.test(entry))) issues.push("Projects without VST3 support must list it under unsupported capabilities");
  // Flag only affirmative false claims of a compiled/native artifact. Honest
  // negations ("not a compiled binary", "no native build") are allowed.
  const falseNativeClaim = /(?<!\bnot\s)(?<!\bno\s)\b(compiled\s+binary\s+(?:ready|produced|built)|native\s+build\s+(?:ready|complete|produced)|installed\s+(?:plugin|binary)|exported\s+a\s+compiled)/i;
  if (summary && [...summary.proven, ...summary.conceptual, ...summary.understood].some(entry => falseNativeClaim.test(entry))) issues.push("Capability summary must not claim a compiled or native export that does not exist");
  const vst3Exportable = project.brief.targets.some(target => target.target === "vst3" && target.supported && target.stage === "exportable");
  if (vst3Exportable && (!project.native || !codeAssets.has(project.native.dspAssetId))) issues.push("Exportable VST3 target requires a linked native DSP asset");
  if (vst3Exportable && project.brief.controls.some(control => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(control.id))) issues.push("Exportable VST3 controls require native-safe stable IDs");
  const expectedNative = {
    effect: ["dynamics", "dynamics"], instrument: ["synthesizer", "synthesizer"], sampler: ["sampler", "synthesizer"],
    mastering: ["dynamics", "dynamics"], utility: ["utility", "filter"],
  }[project.kind];
  if (vst3Exportable && (!expectedNative || project.native?.family !== expectedNative[0] || project.native?.category !== expectedNative[1])) issues.push("Native export classification does not match the project kind");
  if (!project.brief.evidence.some(e => e.pass && (e.grade === "measured" || e.grade === "static"))) issues.push("Requires passing measured or static quality evidence");
  if (project.kind === "effect" && (!project.processor || !codeAssets.has(project.processor.dspAssetId) || !Array.isArray(project.processor.parameters) || project.processor.parameters.some(id => !controls.has(id)))) issues.push("Effect processor must link parameters and a DSP asset");
  if (project.kind === "instrument" && (!project.midi
    || project.midi.input !== "midi-note"
    || !Number.isInteger(project.midi.voices)
    || project.midi.voices < 1
    || project.midi.voices > 128
    || !Array.isArray(project.midi.noteRange)
    || project.midi.noteRange.length !== 2
    || !project.midi.noteRange.every(note => Number.isInteger(note) && note >= 0 && note <= 127)
    || project.midi.noteRange[0] >= project.midi.noteRange[1])) issues.push("Instrument requires a valid bounded MIDI note contract");
  if (project.kind === "sampler" && (!Array.isArray(project.assets) || !Array.isArray(project.pads))) issues.push("Sampler requires pads and assets");
  if (project.kind === "sampler" && Array.isArray(project.assets) && new Set(project.assets.map(a => a.distinctFingerprint)).size !== project.assets.length) issues.push("Sampler assets must have distinct fingerprints");
  if (project.kind === "sampler" && Array.isArray(project.pads) && (ids(project.pads).size !== project.pads.length || new Set(project.pads.map(p => p.midiNote)).size !== project.pads.length || project.pads.some(p => !Number.isInteger(p.midiNote) || p.midiNote < 0 || p.midiNote > 127 || !project.assets?.some(a => a.id === p.assetId)))) issues.push("Sampler pad references or MIDI notes are invalid");
  if (project.kind === "sequencer" && (!project.sequence || !Number.isFinite(project.sequence.bpm) || project.sequence.bpm <= 0 || !project.sequence.persistenceKey || !Array.isArray(project.sequence.events) || ids(project.sequence.events).size !== project.sequence.events.length || project.sequence.events.some(e => e.step < 0 || e.step >= project.sequence.stepsPerBar || e.durationSteps <= 0 || e.velocity < 0 || e.velocity > 1))) issues.push("Sequencer timing or persistence is invalid");
  if (project.kind === "mixer" && (!project.mixer || !Array.isArray(project.mixer.channels) || !Array.isArray(project.mixer.buses) || ids(project.mixer.channels).size !== project.mixer.channels.length || ids(project.mixer.buses).size !== project.mixer.buses.length || project.mixer.channels.some(c => !project.mixer.buses.some(b => b.id === c.busId) || !Number.isFinite(c.gain) || !nodes.has(c.id)) || project.mixer.buses.some(b => !Number.isFinite(b.gain) || !nodes.has(b.id)))) issues.push("Mixer routing or gain isolation is invalid");
  if (project.kind === "mastering" && (!Array.isArray(project.chain) || !["eq", "compressor", "limiter"].every((type, i) => project.chain[i]?.type === type && project.chain[i].enabled && nodes.has(project.chain[i].id)))) issues.push("Mastering chain must be linked, enabled EQ, compressor, limiter");
  if (project.kind === "utility" && (!project.analyzer || project.analyzer.type !== "meter" || !nodes.has(project.analyzer.sourceNodeId) || project.analyzer.ballisticsMs <= 0 || project.analyzer.peakHoldMs <= 0)) issues.push("Utility requires a connected meter model");
  if (project.kind === "daw" && (!project.workstation || !Number.isInteger(project.workstation.tracks) || project.workstation.tracks < 1 || !Array.isArray(project.workstation.buses) || !project.workstation.buses.some(bus => bus.kind === "master") || project.workstation.buses.some(bus => !bus.id || !["audio", "return", "master"].includes(bus.kind)) || !Number.isFinite(project.workstation.transportBpm) || project.workstation.transportBpm <= 0 || project.preview.model !== "browser-workstation")) issues.push("DAW project requires a bounded browser-workstation model with a master bus");
  return { valid: !issues.length, issues };
}

/**
 * Migrates a persisted or provider project from an older shipped contract to the
 * current one, filling in fields introduced by later versions with truthful
 * defaults so a project stored before those fields existed still loads. This is
 * persistence-safe: it never fabricates evidence, only structural placeholders
 * that then face full validation.
 */
function migrateProjectShape(value: Record<string, unknown>): Record<string, unknown> {
  const migrated: Record<string, unknown> = { ...value };
  // Version tag: 1 and "1.0" both roll forward to the current version.
  if (value.version === 1 || value.version === "1.0") migrated.version = AUDIO_SOFTWARE_PROJECT_VERSION;

  const brief = (typeof value.brief === "object" && value.brief) ? { ...(value.brief as Record<string, unknown>) } : undefined;
  if (brief) {
    // goal (v1.1): fall back to the stored purpose so intent survives.
    if (typeof brief.goal !== "string") brief.goal = typeof brief.purpose === "string" ? brief.purpose : "";
    // capability summary (v1.1): reconstruct honestly from evidence/targets.
    if (!brief.summary || typeof brief.summary !== "object") {
      const evidenceList = Array.isArray(brief.evidence) ? (brief.evidence as QualityEvidence[]) : [];
      const targets = Array.isArray(brief.targets) ? (brief.targets as Array<{ target: string; supported: boolean }>) : [];
      const vst3 = targets.some(target => target.target === "vst3" && target.supported);
      brief.summary = {
        understood: [`Read as a ${String(value.kind)} project`],
        changed: ["Migrated from an earlier stored contract version"],
        proven: evidenceList.filter(e => e.pass && (e.grade === "measured" || e.grade === "static")).map(e => `${e.check}: ${e.detail}`),
        conceptual: evidenceList.filter(e => e.grade === "conceptual").map(e => `${e.check}: ${e.detail}`),
        unsupported: vst3 ? [] : ["Native VST3 export is not offered for this project kind."],
      };
    }
    // Explicit brief shape fields (v1.1): safe structural defaults so an older
    // stored project loads and validates without fabricating evidence.
    const kind = String(value.kind);
    if (!Array.isArray(brief.audiences) || (brief.audiences as unknown[]).length === 0) {
      brief.audiences = [`A musician or engineer working with ${kind} audio software`];
    }
    if (!Array.isArray(brief.workflows) || (brief.workflows as unknown[]).length === 0) {
      brief.workflows = [`Use in a browser-based ${kind} workflow`];
    }
    if (typeof brief.interfaceDescription !== "string" || !brief.interfaceDescription) {
      brief.interfaceDescription = `A browser-based ${kind} with standard controls.`;
    }
    if (!brief.interfaceRoles || typeof brief.interfaceRoles !== "object") {
      brief.interfaceRoles = typeof brief.uiRoles === "object" && brief.uiRoles ? brief.uiRoles : {};
    }
    if (!Array.isArray(brief.platformTargets) || (brief.platformTargets as unknown[]).length === 0) {
      const targets = Array.isArray(brief.targets) ? (brief.targets as Array<{ target: string; supported: boolean; stage?: string }>) : [];
      brief.platformTargets = targets.map(t => t.target === "browser" ? "Browser — ready now" : t.supported ? "VST3 — scaffold available" : "VST3 — not supported");
      if ((brief.platformTargets as string[]).length === 0) brief.platformTargets = ["Browser — ready now"];
    }
    if (!Array.isArray(brief.validationRequirements) || (brief.validationRequirements as unknown[]).length === 0) {
      brief.validationRequirements = ["Browser model must produce runnable output", "All cross-references must be stable"];
    }
    if (!Array.isArray(brief.decisions)) {
      brief.decisions = [];
    }
    migrated.brief = brief;
  }

  const preview = (typeof value.preview === "object" && value.preview) ? { ...(value.preview as Record<string, unknown>) } : undefined;
  if (preview && typeof preview.fidelity !== "string") {
    const kind = String(value.kind);
    preview.fidelity = kind === "daw" ? "browser-workstation"
      : (kind === "effect" || kind === "mastering" || kind === "instrument") ? "processor-audition"
      : "focused-simulation";
    migrated.preview = preview;
  }
  return migrated;
}

/** Normalizes untrusted provider or persisted JSON; unknown versions and malformed values are rejected explicitly. */
export function normalizeAudioSoftwareProjectCandidate(candidate: unknown): { project?: AudioSoftwareProject; limitations: string[]; validation: ProjectValidation } {
  if (!candidate || typeof candidate !== "object") return { limitations: ["Provider output is not an object."], validation: { valid: false, issues: ["Invalid provider output"] } };
  const value = candidate as Record<string, unknown>;
  const migrated = migrateProjectShape(value);
  if (migrated.version !== AUDIO_SOFTWARE_PROJECT_VERSION) return { limitations: [`Only AudioSoftwareProject contract version ${AUDIO_SOFTWARE_PROJECT_VERSION} is supported.`], validation: { valid: false, issues: ["Unsupported project version"] } };
  const project = migrated as unknown as AudioSoftwareProject;
  let validation: ProjectValidation;
  try {
    validation = validateAudioSoftwareProject(project);
  } catch {
    validation = { valid: false, issues: ["Provider output has an invalid project shape"] };
  }
  return { project: validation.valid ? project : undefined, limitations: validation.valid ? [] : ["Provider output failed contract validation; it was not activated."], validation };
}
export function evidence(grade: QualityEvidence["grade"], check: string, detail: string): QualityEvidence { return { grade, check, detail, pass: true }; }