export interface PluginParameter {
  id: string;
  name: string;
  min: number;
  max: number;
  defaultValue: number;
  value: number; // Active live value
  unit: string;
  controlType?: "slider" | "knob" | "toggle" | "button" | "number" | "label" | "meter" | "eq" | "waveform" | "pad" | "amp" | "cab" | "mic" | "mic_stand";
  width?: "full" | "half" | "third";
  x?: number;
  y?: number;
  w?: number;
  h?: number;

  // Custom visual properties for high-end customization
  bgColor?: string;
  borderColor?: string;
  accentColor?: string;
  textColor?: string;
  customText?: string; // Brand/custom overlay text for amp, cab, label
  customStyle?: string; // vintage, metal, cyberpunk, sleek, grid
  fontStyle?: "sans" | "mono" | "serif" | "grotesk" | "orbitron";
  valX?: number; // secondary parameter coordinate (e.g. mic positioning X coordinate 0-100)
  valY?: number; // secondary parameter coordinate (e.g. mic positioning Y coordinate 0-100)
  eqFreqs?: number[]; // custom frequencies for EQ visualizer nodes

  // Extended amp/cab customizer properties
  ampTolexPattern?: "leather" | "carbon" | "tweed" | "wood" | "snakeskin" | "metalgrid";
  ampKnobStyle?: "chickenhead" | "silvercap" | "pointer" | "neonring" | "vintage";
  ampChannelType?: "clean" | "crunch" | "lead" | "modern";
  ampTubeGlow?: boolean;
  cabGrillStyle?: "weave" | "metalgrid" | "stripes" | "pinstripe" | "retro";
  cabSize?: "1x12" | "2x12" | "4x12" | "8x10";
  cabMicModel?: "SM57" | "R-121" | "MD421" | "C414";

  // IR (Impulse Response) properties for cabinet modeling
  irFiles?: { id: string; name: string; size: string; data: string }[];
  activeIrId?: string;
}

export interface AudioPlugin {
  id: string;
  name: string;
  category: "distortion" | "delay" | "filter" | "synthesizer" | "dynamics" | "modulation" | "reverb";
  description: string;
  parameters: PluginParameter[];
  dspFunction: string; // JavaScript body for: function(input, params, contextState) { ... return output; }
  faustCode: string;
  cppJuceCode: string;
  createdAt: string;

  /**
   * Linear post-DSP gain applied by the audio engine. Set by the quality gate
   * to restore unity loudness when the generated code's internal gain staging
   * is off. 1 (or undefined) = no correction.
   */
  outputTrim?: number;

  /**
   * When true the audio engine runs a one-pole DC blocker after the DSP --
   * set by the quality gate when the generated code accumulates DC offset.
   */
  dcBlock?: boolean;

  /** Quality gate scores (0-100 per dimension) from the last generation. */
  quality?: {
    looks: number;
    performance: number;
    latency: number;
    musicality: number;
  };

  /** Structured build report from the last quality-gate run: measured facts
   *  (what compiled, which controls verified audible, fixes applied,
   *  confidence) — the antidote to claiming success without evidence. */
  buildReport?: BuildReport;

  /** GUI archetype id ("grid" | "eq_focus" | "strip" | "pedal" | "rack" |
   *  "panel" | "showpiece" | "custom", or a saved custom archetype's name)
   *  -- the layout composition this plugin's board is built from. Set by
   *  the quality gate at build time (see guiArchetypes.ts), and overridable
   *  by the user via the archetype picker in the Pro UI Designer. */
  uiArchetype?: string;

  // Overall faceplate skin configuration properties
  customSkin?: {
    bgImage?: string; // Base64 dataURL or background image URL
    bgColor?: string; // faceplate background
    borderColor?: string; // faceplate border
    textColor?: string; // faceplate text
    accentColor?: string; // knobs and sliders glow color
    fontStyle?: "sans" | "mono" | "serif" | "grotesk" | "orbitron";
    glowStyle?: "none" | "neon" | "vintage" | "flat" | "shadow";
    borderWidth?: number;
    bgOpacity?: number; // overlay alpha
  };
}

/**
 * Measured build evidence emitted by the quality gate for every generation.
 * Intent/plan claims live elsewhere; everything in here was actually
 * observed: compilation, per-knob audibility, applied fixes, scores.
 */
export interface BuildReport {
  /** What the build set out to do (spec goal or prompt excerpt). */
  intent: string;
  /** Detected design attributes driving the theme (may be empty). */
  attributes: string[];
  layout: "focus" | "grid";
  primaryControls: string[];
  secondaryControls: string[];
  /** False when the DSP failed to compile or NaN'd on the default render. */
  compiled: boolean;
  scores: { looks: number; performance: number; latency: number; musicality: number };
  audibleParams: string[];
  deadParams: string[];
  unstableParams: string[];
  /** Non-primary test signals the plugin goes silent on while audible on the
   *  arp -- a cross-signal dead spot (chokes plucks/sustains). Reported and
   *  penalized by the refinement loop; not part of the four headline scores. */
  silentOnSignals?: string[];
  /** 0..1 inharmonic-energy ratio on a clean tone -- aliasing/harshness for a
   *  processor, or intended character for a ring-mod/pitch/generator. Raw,
   *  informational. */
  aliasingIndex?: number;
  /** True when aliasingIndex is high AND the family is one that should stay
   *  spectrally clean (drive, filter, EQ, dynamics, delay, reverb...) -- i.e.
   *  genuine digital fizz, not intended grit. Drives the refinement penalty;
   *  never a headline score. */
  harsh?: boolean;
  /** Measured inter-sample true peak (dBTP) of the program render at
   *  defaults, 4x oversampled via Catmull-Rom reconstruction. Informational;
   *  a note is added when it risks clipping a DAC (> -0.1 dBTP). */
  truePeakDb?: number;
  /** True when the DSP produced a measurably distinct right channel
   *  (state.outR) on the program render — genuine stereo, not dual-mono. */
  stereoOutput?: boolean;
  /** Static engineering-quality score (0-100) from the DSP code auditor:
   *  real-time safety, numerical robustness, parameter smoothing,
   *  maintainability. Informational — measures the CODE, not the sound. */
  codeHealth?: number;
  /** Concrete, actionable engineering findings from the code auditor. */
  codeFindings?: string[];
  /** Why this topology was chosen — the engineering brain made visible.
   *  Present only when the prompt's wording drove a non-default design. */
  engineeringChoice?: { topology: string; rationale: string; evidence: string[] };
  /** How well the build performs its family's core job (0-100) with the
   *  measured evidence — the discriminator among CORRECT builds. Absent for
   *  families with no meaningful functional test. */
  functionalFitness?: { score: number; metric: string; evidence: string };
  /** 0-100 coverage of the control vocabulary a REAL unit of this family
   *  has (see featureManifest.ts). Functional fitness asks whether the
   *  plugin does its job; this asks whether it's a complete instrument or a
   *  minimal one. Informational — ranks candidates, never gates shipping.
   *  `missing` names the required/expected controls this build lacks. */
  featureDepth?: { score: number; evidence: string; missing: string[] };
  /**
   * Calibration repairs the gate applied: a knob whose functional-fitness
   * measurement (echo timing, filter corner, LFO rate, oscillator pitch)
   * implied an exact multiplicative correction had its DSP reads rescaled so
   * the number on the knob matches what it actually does. Each entry was
   * applied, RE-MEASURED, and kept ONLY because functional fitness measurably
   * improved and nothing on the musicality side regressed — never assumed.
   * `before`/`after` are the functional-fitness score for that metric.
   * Informational; the shipped dspFunction already reflects these repairs.
   */
  calibrationRepairs?: Array<{ paramId: string; factor: number; metric: string; before: number; after: number }>;
  /**
   * Measured per-sample DSP wall-time (real audio cost), combined with the
   * static real-time-safety findings. This is the signal the headline
   * `latency` score claims to carry but doesn't — scoreLatency grades
   * generation wall-time and returns a flat 100 for every deterministic/
   * offline build, so a per-sample-convolution reverb and a one-pole filter
   * score identically there. Informational — ranks candidates in
   * refinementScore(), never touches the headline `latency` score (wall-clock
   * timing is noisy on a shared machine; a flaky headline score would be
   * worse than the current uninformative-but-stable 100).
   */
  cpuCost?: { nsPerSample: number; budgetFraction: number; score: number; staticIssues: string; evidence: string };
  /**
   * Does this build behave like a known-good member of its family? The
   * candidate and its family's GOLDEN RECIPE are run through the SAME probe
   * signal (each at its own defaults) and their responses' spectral shapes
   * are compared. Catches classes of structural wrongness no single named
   * parameter check can name — a build that "doesn't look like a compressor
   * at all" even though every individual knob passed its own test. NOT a
   * quality verdict (a legitimately better design should be free to diverge
   * from one specific reference) — informational, ranks candidates in
   * refinementScore(), never gates shipping. Absent for composite families
   * (multiband_saturator, hybrid_other, utility) with no single reference.
   */
  referenceDeviation?: { referenceId: string; deviation: number; score: number; evidence: string };
  /** Deterministic repairs and polish applied by the gate. */
  fixes: string[];
  /**
   * Per-parameter SEMANTIC honesty checks: a knob named Cutoff must actually
   * brighten as it opens, Feedback must actually lengthen the tail, Drive
   * must actually add harmonics, Mix must actually move dry->wet. Each entry
   * is one measured directional test; `ok: false` means the knob is alive
   * but does the WRONG thing (or nothing directional). Violations are
   * penalized in musicality and fed to the refinement loop as evidence.
   */
  semanticChecks?: Array<{
    param: string;
    /** The property tested: "brightness" | "tail" | "harmonics" | "wet-dry". */
    property: string;
    /** Measured low-setting vs high-setting values, for the evidence trail. */
    detail: string;
    ok: boolean;
  }>;
  /** Ids of parameters that failed their semantic check (subset of the above). */
  semanticViolations?: string[];
  /** 0-100: min score minus penalties for dead/unstable controls. */
  confidence: number;
  /**
   * 0..1: how much the DSP reshapes the dry signal's spectral balance
   * (silence/passthrough ~0, heavily transformed ~1). A correctness signal
   * never substitutes for the gate above — used only as a tie-breaker so
   * the perfecting loop's search can prefer more characterful builds among
   * otherwise-equal candidates.
   */
  characterIndex: number;
  /** Planner job trace (repair history) when the build ran through the
   *  job-graph planner: one entry per worker with acceptance outcome. */
  jobs?: Array<{
    id: string;
    title: string;
    worker: string;
    status: "passed" | "repaired" | "fallback" | "failed";
    attempts: number;
    ms: number;
    confidence: number;
    evidence: string;
  }>;
  /** Perfecting-loop trace when the user enabled refinement: one entry per
   *  rework iteration (iteration 0 = an alternate seed build considered
   *  before the loop), accepted only when it scored strictly higher. */
  refinement?: Array<{
    iteration: number;
    action: string;
    accepted: boolean;
    score: number;
  }>;
}

export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  systemInstruction: string;
  avatarColor: string;
  temperature: number;
  isBuiltIn: boolean;
}

export interface ChatMessage {
  id: string;
  senderId: string; // agent id or 'user'
  senderName: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
}

export interface DspCritiqueItem {
  category: string; // e.g. "Clipping Danger", "Mathematical Bug", "Feedback Overflow", "Efficiency"
  snippet: string;
  issue: string;
  recommendationCode: string;
}

export interface DSPAnalysisResult {
  purityScore: number; // 0-100 indicating clean arithmetic
  stabilityAssessment: string; // e.g. "Highly Stable", "Vulnerable to Blowup", "Feedback Overload Risk"
  mathCritique: string;
  suggestions: DspCritiqueItem[];
  performanceEstimate: string; // e.g. "Low CPU (O(1))", "Moderate CPU (Float64 states)", etc.
}

// Visual Signal Canvas Types matching canvas_to_code
export type CanvasNodeType =
  | "input"
  | "gain"
  | "saturator"
  | "ladder_filter"
  | "comb_delay"
  | "chorus"
  | "tremolo"
  | "output";

export interface CanvasNode {
  id: string;
  type: CanvasNodeType;
  title: string;
  active: boolean;
  settings: Record<string, number>; // settings mapped to param values or bounds
}

// Healthcheck Report Types matching beta_healthcheck
export interface SignalMetrics {
  maxAmplitude: number;
  dcOffset: number;
  clippingSamples: number;
  totalSamples: number;
  clippingRatio: number;
  isStable: boolean;
  hasNaN: boolean;
}

export interface DiagnosticsReport {
  timestamp: string;
  overallHealthStatus: "PRISTINE" | "WARNING" | "CRITICAL";
  unstableTonesDetected: boolean;
  dcAccumulatorRisk: boolean;
  clippingSevereRisk: boolean;
  testSignals: {
    impulse: SignalMetrics;
    lowFrequencySweep: SignalMetrics;
    extremeFeedback: SignalMetrics;
  };
  recommedSummary: string;
}

