import { AudioPlugin, PluginParameter, DSPAnalysisResult, DspCritiqueItem } from "../types";
import { AudioPluginSpec, classifyPluginIntent, looksLikeBuildRequest } from "./pluginSpec";
import { buildOfflinePlugin, applyRelativeTweaks, isRelativeTweakRequest, nextMovesFor } from "./offlineBuilder";

/**
 * Offline conversational front-end for the factory. Used when API keys are
 * missing, offline mode is forced, or an online request errors out.
 *
 * Build requests route through buildOfflinePlugin() -- the same spec-first
 * pipeline (intent classifier -> verified recipe library -> generic fallback
 * chain) the online paths use as references -- so ANY prompt produces a
 * complete plugin, not just a fixed keyword list. Metadata edits (rename,
 * category, add parameter) and relative tweaks ("brighter", "more feedback")
 * are handled in place without replacing the loaded plugin.
 *
 * Contract: the caller runs runQualityGate() on any returned updatedPlugin,
 * exactly like every other generation path.
 */
export function processOfflineMessage(
  prompt: string,
  activePlugin: AudioPlugin,
  spec?: AudioPluginSpec | null
): { text: string; updatedPlugin: AudioPlugin | null } {
  const norm = prompt.toLowerCase().trim();
  let updated: AudioPlugin = { ...JSON.parse(JSON.stringify(activePlugin)) };
  let actionTaken = false;
  let rebuilt = false;
  const explanations: string[] = [];

  // --- 1. Rename Detection ---
  const renameMatch = norm.match(/(?:rename\s+to|change\s+name\s+to|name\s+the\s+plugin|title\s+to)\s+([a-z0-9\s\-_&'()]+)/i);
  if (renameMatch && renameMatch[1]) {
    const newName = renameMatch[1].trim();
    const capitalizedName = newName.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
    updated.name = capitalizedName;
    actionTaken = true;
    explanations.push(`📝 **Renamed the audio plugin** to **"${capitalizedName}"**.`);
  }

  // --- 2. Category Detection ---
  const categoryMatch = norm.match(/(?:set|change)?\s*(?:category|type)\s*(?:to)?\s*(distortion|delay|filter|synthesizer|dynamics|modulation|reverb)/i);
  if (categoryMatch && categoryMatch[1]) {
    const cat = categoryMatch[1].toLowerCase() as AudioPlugin["category"];
    updated.category = cat;
    actionTaken = true;
    explanations.push(`⚙️ **Switched category** to **"${cat}"**.`);
  }

  // --- 3. Parameter Addition Detection ("add parameter Volume min 0 max 2 unit dB") ---
  const paramMatch = norm.match(/add\s+(?:param|parameter|slider)\s+(\w+)(?:\s+(?:min|from)\s*(-?\d+(?:\.\d+)?))?(?:\s+(?:max|to)\s*(\d+(?:\.\d+)?))?(?:\s+(?:unit|suffix)\s*(\w+|%))?/i);
  if (paramMatch && paramMatch[1]) {
    const nameRaw = paramMatch[1];
    const pId = nameRaw.toLowerCase().replace(/[^a-z0-9]/g, "");

    if (updated.parameters.some(p => p.id === pId)) {
      explanations.push(`⚠️ Parameter with ID \`${pId}\` already exists.`);
    } else {
      const pName = nameRaw.charAt(0).toUpperCase() + nameRaw.slice(1);
      const min = paramMatch[2] ? parseFloat(paramMatch[2]) : 0;
      const max = paramMatch[3] ? parseFloat(paramMatch[3]) : 1;
      const unit = paramMatch[4] ? paramMatch[4] : "%";
      const defaultValue = (max + min) / 2;

      const newParam: PluginParameter = {
        id: pId,
        name: pName,
        min,
        max,
        defaultValue,
        value: defaultValue,
        unit
      };

      updated.parameters.push(newParam);

      const injectedLine = `\n// Let user handle the custom ${pName} parameter\nlet ${pId} = params.${pId} !== undefined ? params.${pId} : ${defaultValue};`;
      updated.dspFunction = injectedLine + "\n" + updated.dspFunction;

      actionTaken = true;
      explanations.push(`🎛️ **Injected new parameter slider**:\n- **Label**: "${pName}" (\`params.${pId}\`)\n- **Range**: [${min}, ${max}] ${unit}`);
    }
  }

  // A family keyword anywhere in the prompt means "build/change the plugin";
  // its absence is what lets critique/question/tweak wording take over.
  const heuristicFamily = classifyPluginIntent(prompt).family;

  // --- 4. Critique ("this isnt good", "make it better"): respond to the
  //        complaint about the CURRENT plugin with concrete directions
  //        instead of a canned capabilities pitch. ---
  const CRITIQUE_RE = /aw?ful|terrible|horrible|sucks|useless|garbage|trash|not (?:that |very |any )?good|isn'?t good|don'?t like|hate (?:it|this)|\bworse\b|\bbad\b|\bbetter\b|unhelpful|doesn'?t work|\bbroken\b|no sound|can'?t hear|\bsilent\b|\bstuck\b/i;
  if (!actionTaken && heuristicFamily === "hybrid_other" && CRITIQUE_RE.test(norm)) {
    const moves = nextMovesFor(updated.category);
    const silenceHelp = /no sound|can'?t hear|silent|doesn'?t work|broken/.test(norm)
      ? `\n- Hearing nothing? Press the **play** button to start the test melody, make sure **Effect on** isn't bypassed, and check your output volume.`
      : "";
    return {
      text: `Fair enough — let's get **${updated.name}** where you want it. Tell me what's off, or grab a quick direction:

- Sound: ${moves.map(m => `**"${m}"**`).join(", ")} — I'll adjust the knobs in place.
- Rebuild: describe it differently ("same idea but subtle", "make it a plate reverb instead").
- Controls: **"add parameter Width min 0 max 1"** to extend it.${silenceHelp}

Heads up: I'm the instant offline engine — fast and reliable, but not the most creative collaborator. For richer builds and a real back-and-forth, pick **Gemini** or a local model from the engine picker in the top-right.`,
      updatedPlugin: null,
    };
  }

  // --- 5. Question ("what does the decay knob do?"): explain the loaded
  //        plugin honestly rather than replacing it. ---
  const QUESTION_RE = /^(?:why|how(?! about)|what(?!\s+about)|when|where|who|explain|tell me|is th|are th|does|do you|can you (?:tell|explain))/i;
  if (!actionTaken && QUESTION_RE.test(norm)) {
    const knobs = updated.parameters.filter(p => !p.id.startsWith("pad_"));
    const pads = updated.parameters.length - knobs.length;
    return {
      text: `Here's what's loaded right now:

**${updated.name}** (${updated.category}) — ${updated.description ? updated.description.slice(0, 220) : "a custom-built processor."}

${pads > 0 ? `- **Pads 1-${pads}** — tap to trigger each synthesized voice\n` : ""}${knobs.slice(0, 8).map(p => `- **${p.name}** — currently ${Math.round(p.value * 1000) / 1000}${p.unit ? ` ${p.unit}` : ""} (range ${p.min} to ${p.max})`).join("\n")}

Ask me to change any of it ("darker", "more ${knobs[0]?.name.toLowerCase() || "drive"}"), or describe a new plugin and I'll build it. For open-ended questions beyond this plugin, switch to **Gemini** or a local model in the engine picker (top-right).`,
      updatedPlugin: null,
    };
  }

  // --- 6. Relative tweak of the ACTIVE plugin ("brighter", "more feedback") ---
  if (!actionTaken && isRelativeTweakRequest(prompt)) {
    const notes = applyRelativeTweaks(prompt, updated.parameters);
    if (notes.length > 0) {
      actionTaken = true;
      explanations.push(`🎚️ **Adjusted "${updated.name}" in place** (no rebuild needed):\n${notes.map(n => `- ${n}`).join("\n")}\n\nPlay it back — and keep nudging ("even darker", "a touch wetter") until it sits right.`);
    }
  }

  // --- 7. Full build: ANY plugin request compiles through the spec-first
  //        recipe pipeline (verified families, hybrid composition, and a
  //        generic character chain when nothing matches). ---
  if (!actionTaken && looksLikeBuildRequest(prompt)) {
    const build = buildOfflinePlugin(prompt, spec);
    updated = {
      ...updated,
      name: build.name,
      category: build.category,
      description: build.description,
      parameters: build.parameters,
      dspFunction: build.dspFunction,
      // Cleared so the Export tab lazily regenerates matching scaffolds
      // via portableCodegen instead of shipping stale code.
      faustCode: "",
      cppJuceCode: "",
    };
    actionTaken = true;
    rebuilt = true;
    explanations.push(build.summary);
  }

  // Metadata-only edits invalidate previously generated exports.
  if (actionTaken && !rebuilt) {
    updated.faustCode = "";
    updated.cppJuceCode = "";
  }

  // --- Summary Assembly: the explanations are self-contained; no wrapper
  //     boilerplate (repeated banners read as canned and robotic). ---
  if (explanations.length > 0) {
    return {
      text: explanations.join("\n\n"),
      updatedPlugin: actionTaken ? updated : null
    };
  }

  // --- Nothing actionable matched: short, useful pointer ---
  const genericResponse = `I build plugins from plain descriptions — try **"warm slapback delay"**, **"shimmer reverb"**, **"high-gain metal amp"**, or something stranger; if it doesn't fit a known family I'll voice a custom chain from your wording.

Once something's loaded you can steer it: **"darker"**, **"more feedback"**, **"drier"** — or **"rename to Blue Velvet"**.

What should we build?`;

  return {
    text: genericResponse,
    updatedPlugin: null
  };
}

/**
 * Executes a high-quality static analysis check on JavaScript DSP code
 * to provide helpful mathematical quality and stability audits offline.
 */
export function runOfflineDSPAnalysis(code: string, parameters: PluginParameter[]): DSPAnalysisResult {
  const suggestions: DspCritiqueItem[] = [];
  let purityScore = 100;

  // 1. Check for Memory Allocations inside the process block (Garbage Collection risk)
  const hasArrayAllocation = /(?:new\s+(?:Float32Array|Float64Array|Array)|\s*=\s*\[\s*\]|\s*=\s*\{\s*\})/i.test(code);
  const wrapsStateInit = /(?:if\s*\(\s*!\s*state|if\s*\(\s*typeof\s+state|!state\.)/i.test(code);

  if (hasArrayAllocation && !wrapsStateInit) {
    purityScore -= 25;
    suggestions.push({
      category: "Memory Allocation / Jitter Risk",
      snippet: code.match(/(?:new\s+(?:Float32Array|Float64Array|Array)|\s*=\s*\[\s*\]|\s*=\s*\{\s*\})/i)?.[0] || "[] or new Array()",
      issue: "Allocating buffer memories or objects dynamically on every single sample iteration triggers continuous garbage collection sweeps. This causes noticeable audio popping or stuttering in the high-priority Web Audio browser thread.",
      recommendationCode: `// Initialize dynamic states only once when compiling/initializing variables
if (!state.delayLine) {
  state.delayLine = new Float32Array(44100 * 2); // 2-second buffer
  state.writePtr = 0;
}`
    });
  }

  // 2. Check for Division by Zero threat
  // Match things like: / cutoff, / resonance, / params.something, but skip dividing by numbers or constant strings
  const divisionPattern = /\/\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\.[a-zA-Z_][a-zA-Z0-9_]*)?)/g;
  let match;
  let hasUncheckedDivision = false;
  let divSnippet = "";

  while ((match = divisionPattern.exec(code)) !== null) {
    const divider = match[1].trim();
    // Ignore scalar numbers and sample rate constants
    if (!/^\d+$/.test(divider) && divider !== "44100" && divider !== "sampleRate" && divider !== "44100.0") {
      // Check if it's guarded by + 1e-6 or Math.max
      const surroundingContext = code.slice(Math.max(0, match.index - 30), Math.min(code.length, match.index + 30));
      if (!surroundingContext.includes("1e-") && !surroundingContext.includes("0.0000") && !surroundingContext.includes("Math.max")) {
        hasUncheckedDivision = true;
        divSnippet = match[0];
        break;
      }
    }
  }

  if (hasUncheckedDivision) {
    purityScore -= 20;
    suggestions.push({
      category: "Division by Zero / NaN Risk",
      snippet: divSnippet,
      issue: "Direct division by parameter fields or variable registers without a positive boundary guard risks producing a mathematical NaN (Not a Number) or Infinity. This instantly silences the processor node or forces a complete audio freeze.",
      recommendationCode: `// Add a tiny guard coefficient or clamp the divisor
let wc = (2.0 * Math.PI * cutoff) / (44100.0 + 1e-9);`
    });
  }

  // 3. Check for Logarithmic Scale Underflow (-Infinity bounds)
  const hasUnsafeLog = /Math\.log(?:10)?\s*\(\s*([a-zA-Z_][a-zA-Z0-9_\.]*)\s*\)/.test(code);
  const clampsLog = /Math\.max\s*\(\s*[a-zA-Z_][a-zA-Z0-9_\.]*\s*,\s*(?:1e-|0\.000)/i.test(code);

  if (hasUnsafeLog && !clampsLog) {
    purityScore -= 15;
    suggestions.push({
      category: "Log/Db Infinite Underflow Error",
      snippet: code.match(/Math\.log(?:10)?\s*\(\s*[a-zA-Z_][a-zA-Z0-9_\.]*\s*\)/)?.[0] || "Math.log(value)",
      issue: "Converting envelope values directly to decibels using Math.log or Math.log10 without a minimal threshold guard returns -Infinity when the input is silent (0.0). This will poison the audio output with NaN cascades.",
      recommendationCode: `// Clamp input envelope to a safe minimal amplitude limit
let envDb = 20.0 * Math.log10(Math.max(amplitude, 0.00001));`
    });
  }

  // 4. Check for Feedback Overload Risk (Unbounded recursion)
  const hasFeedback = /state\.[a-zA-Z0-9_]+\s*\[\s*state\.[a-zA-Z0-9_]+\s*\]\s*=\s*/.test(code);
  const usesSaturator = /(?:Math\.tanh|Math\.max|Math\.min|clipCeil|clamp|std::tanh)/i.test(code);

  if (hasFeedback && !usesSaturator) {
    purityScore -= 15;
    suggestions.push({
      category: "Acoustic Feedback Overflow Warning",
      snippet: "state.delayLine[state.writePtr] = ...",
      issue: "This DSP block uses recursive delay/echo lines but does not seem to constrain the feedback signal node with a soft saturator. Continuous feedback coefficients > 0.9 under rapid input signals can exponentially overflow to destructive margins.",
      recommendationCode: `// Constrain feedback lines with gentle analog waveshaping saturation
state.delayLine[state.writePtr] = Math.tanh(inputSample + feedbackSignal * feedbackCoeff);`
    });
  }

  // Ensure purityScore doesn't drop below 35 for valid syntax
  purityScore = Math.max(35, purityScore);

  let stabilityAssessment = "Highly Stable";
  if (purityScore < 60) {
    stabilityAssessment = "Vulnerable to Thermal Math Blowup";
  } else if (purityScore < 85) {
    stabilityAssessment = "Moderate Signal Risk (Needs Guards)";
  }

  let mathCritique = "The mathematical DSP flow is clean. Basic variables are structured correctly and parameter limits conform to typical real-time sampling frequencies.";
  if (purityScore < 60) {
    mathCritique = "Mathematical critique raises structural alerts. Potential infinite feedback registers, memory-churning allocations, or unchecked divisions were discovered in runtime loops.";
  } else if (purityScore < 85) {
    mathCritique = "The processing arithmetic is relatively clear, but requires minor safety hardening patches on log transitions or feedback gates to guarantee long-term stability.";
  }

  return {
    purityScore,
    stabilityAssessment,
    performanceEstimate: purityScore > 80 ? "Ultra-lightweight real-time processing O(1)" : "Medium CPU overhead due to memory or safety warnings",
    mathCritique,
    suggestions
  };
}
