/**
 * Keeps the "Spec & Code Architect" companion tab honest about what's
 * actually loaded. Architect is a from-scratch generator (type a prompt,
 * call the local model, get specs + code) with its own independent state --
 * which meant that after building a plugin anywhere else in the app (chat,
 * a GitHub preset, Canvas, roaming research), opening Architect showed
 * whatever it last generated (or nothing), never the plugin you actually
 * just built. User: "when a plug in is created the other pages should
 * reflect what was built" / "it doesnt seem like Spec & Code Architect
 * follows".
 *
 * This derives Architect's four pieces of state PURELY from data the build
 * already produced -- no local-model call, no extra latency or cost, and
 * nothing invented: every "detail" line traces to a real field on
 * AudioPlugin/BuildReport. When a build carries little evidence (an older
 * saved plugin, or one built before a given measurement existed) the
 * corresponding spec card is simply omitted rather than padded with a guess.
 */
import { AudioPlugin, PluginParameter } from "../types";

export interface ArchitectSpecCard {
  title: string;
  description: string;
  details: string[];
  isEditing: boolean;
}

export interface ArchitectSyncResult {
  prompt: string;
  specs: ArchitectSpecCard[];
  parameters: PluginParameter[];
  code: string;
}

function titleCase(s: string): string {
  return s.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatParam(p: PluginParameter): string {
  const unit = p.unit ? ` ${p.unit}` : "";
  return `${p.name}: ${p.min}${unit} to ${p.max}${unit} (default ${p.defaultValue}${unit})`;
}

/** Derive Architect's spec cards, prompt, parameters and code straight from
 *  an already-built plugin -- deterministic, no LLM involved. */
export function deriveArchitectSyncFromPlugin(plugin: AudioPlugin): ArchitectSyncResult {
  const br = plugin.buildReport;
  const prompt = br?.intent || plugin.description || plugin.name;
  const specs: ArchitectSpecCard[] = [];

  // ---- Card 1: what family/topology this actually is.
  {
    const familyLabel = plugin.family ? titleCase(plugin.family) : titleCase(plugin.category);
    const details: string[] = [`Family: ${familyLabel}`];
    if (br?.engineeringChoice) {
      details.push(`Topology: ${br.engineeringChoice.topology}`);
      details.push(br.engineeringChoice.rationale);
      for (const ev of br.engineeringChoice.evidence || []) details.push(`Evidence: ${ev}`);
    } else {
      details.push("Built from the family's default (golden) topology -- the prompt's wording didn't call for a specialist variant.");
    }
    specs.push({
      title: "Family & Topology",
      description: `What this plugin is, and why it was built this way.`,
      details,
      isEditing: false,
    });
  }

  // ---- Card 2: the actual control surface.
  if (plugin.parameters.length > 0) {
    specs.push({
      title: "Parameters",
      description: `${plugin.parameters.length} control${plugin.parameters.length === 1 ? "" : "s"} on this build.`,
      details: plugin.parameters.map(formatParam),
      isEditing: false,
    });
  }

  // ---- Card 3: quality gate + informational measurements, only the ones
  //      this build actually has evidence for.
  if (plugin.quality || br) {
    const details: string[] = [];
    if (plugin.quality) {
      const q = plugin.quality;
      details.push(`Looks ${q.looks} / Performance ${q.performance} / Latency ${q.latency} / Musicality ${q.musicality}`);
    }
    if (br?.functionalFitness) details.push(`Functional fitness ${br.functionalFitness.score}/100 -- ${br.functionalFitness.metric}: ${br.functionalFitness.evidence}`);
    if (br?.referenceDeviation) details.push(`Reference match ${br.referenceDeviation.score}/100 vs. the ${br.referenceDeviation.referenceId} family reference`);
    if (br?.codeHealth !== undefined) details.push(`Code health ${br.codeHealth}/100`);
    if (typeof br?.truePeakDb === "number") details.push(`True peak ${br.truePeakDb.toFixed(1)} dBTP`);
    if (br?.stereoOutput) details.push("Produces a genuinely distinct stereo image, not dual-mono.");
    if (details.length > 0) {
      specs.push({
        title: "Quality & Fitness",
        description: "Measured, not claimed -- every line here comes from the quality gate's own instrumentation.",
        details,
        isEditing: false,
      });
    }
  }

  // ---- Card 4: build evidence -- what was verified working, what wasn't.
  if (br && (br.audibleParams?.length || br.deadParams?.length || br.unstableParams?.length || br.codeFindings?.length)) {
    const details: string[] = [];
    if (br.audibleParams?.length) details.push(`Verified audible: ${br.audibleParams.join(", ")}`);
    if (br.deadParams?.length) details.push(`No measurable effect: ${br.deadParams.join(", ")}`);
    if (br.unstableParams?.length) details.push(`Unstable at extremes: ${br.unstableParams.join(", ")}`);
    for (const f of br.codeFindings || []) details.push(`Code audit: ${f}`);
    specs.push({
      title: "Build Evidence",
      description: "What the gate actually verified about this build's controls and code.",
      details,
      isEditing: false,
    });
  }

  return { prompt, specs, parameters: plugin.parameters, code: plugin.dspFunction };
}
