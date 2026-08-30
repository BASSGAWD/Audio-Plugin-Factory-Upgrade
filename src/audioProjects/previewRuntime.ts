import type { AudioSoftwareProject } from "./contracts";

type ProcessorModel = {
  noteOn?: (note: number) => void;
  processFrame?: (level: number) => number;
  process?: (sample: number) => number;
};

/**
 * Builds previews exclusively from the validated, constrained project contract.
 * Project codeAssets are downloadable/exportable text, never executable input
 * to the ORANGEJUCE page origin.
 */
export function createTrustedPreviewModel(
  project: AudioSoftwareProject,
  sampleRate = 48_000,
): Record<string, unknown> {
  if (project.kind === "instrument") {
    const voices = new Map<number, number>();
    const level = Number(project.brief.controls.find(control => control.id === "voice_level")?.defaultValue ?? 0.5);
    return {
      noteOn(note: number) {
        if (note >= project.midi.noteRange[0] && note <= project.midi.noteRange[1] && voices.size < project.midi.voices) {
          voices.set(note, 0);
        }
      },
      processFrame(inputLevel = level) {
        let output = 0;
        for (const [note, phase] of voices) {
          output += Math.sin(phase) * inputLevel;
          voices.set(note, (phase + 2 * Math.PI * 440 * 2 ** ((note - 69) / 12) / sampleRate) % (2 * Math.PI));
        }
        return output / Math.max(1, voices.size);
      },
    };
  }
  if (project.kind === "mastering") {
    const ceilingDb = Number(project.brief.controls.find(control => control.id === "ceiling")?.defaultValue ?? -1);
    return {
      process(input: number) {
        const compressed = Math.tanh(input * 0.995 * 1.1);
        const ceiling = 10 ** (ceilingDb / 20);
        return Math.max(-ceiling, Math.min(ceiling, compressed));
      },
    };
  }
  if (project.kind === "effect" && project.processor.mode === "native-model") {
    const mix = Number(project.brief.controls.find(control => control.id === "mix")?.defaultValue ?? 0.5);
    return { process: (input: number) => input * (1 - mix) + Math.tanh(input * 2) * mix };
  }
  if (project.kind === "sampler") {
    const active = new Set<string>();
    return {
      triggerPad(note: number) {
        const pad = project.pads.find(candidate => candidate.midiNote === note);
        if (pad) active.add(pad.assetId);
      },
      processFrame() {
        return active.size ? 0.5 : 0;
      },
    };
  }
  if (project.kind === "sequencer") {
    return {
      eventsAtStep: (step: number) => project.sequence.events.filter(event => event.step === step),
    };
  }
  if (project.kind === "mixer") {
    return {
      mix(inputs: Record<string, number[]>, gains: Record<string, number> = {}) {
        const frames = Math.max(0, ...project.mixer.channels.map(channel => inputs[channel.id]?.length || 0));
        const master = gains.master ?? project.mixer.buses.find(bus => bus.id === "master")?.gain ?? 1;
        return Array.from({ length: frames }, (_, frame) =>
          project.mixer.channels.reduce(
            (sum, channel) => sum + (inputs[channel.id]?.[frame] || 0) * (gains[channel.id] ?? channel.gain),
            0,
          ) * master,
        );
      },
    };
  }
  if (project.kind === "utility") {
    let peak = 0;
    let sumSquares = 0;
    let count = 0;
    return {
      observe(sample: number) {
        const release = Math.exp(-1 / Math.max(1, project.analyzer.ballisticsMs));
        peak = Math.max(peak * release, Math.abs(sample));
        sumSquares += sample * sample;
        count += 1;
        return { peak, rms: Math.sqrt(sumSquares / count) };
      },
    };
  }
  if (project.kind === "daw") {
    return { trackCount: () => project.workstation.tracks };
  }
  throw new Error("This project requires its identity-matched plugin runtime.");
}

/** Executes one processor frame and fails closed on an invalid contract result. */
export function processTrustedPreviewSample(
  project: AudioSoftwareProject,
  model: ProcessorModel,
  input: number,
): number {
  let output: number;
  try {
    if (project.kind === "instrument") {
      if (typeof model.processFrame !== "function") throw new Error("Instrument model is missing processFrame().");
      output = model.processFrame(input);
    } else {
      if (typeof model.process !== "function") throw new Error("Processor model is missing process().");
      output = model.process(input);
    }
  } catch (cause) {
    throw new Error(`Browser processor failed: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  if (!Number.isFinite(output)) throw new Error("Browser processor returned a non-finite sample.");
  return Math.max(-1, Math.min(1, output));
}

export function runTrustedFocusedSimulation(project: AudioSoftwareProject): string {
  const model = createTrustedPreviewModel(project);
  if (project.kind === "sampler") {
    const triggerPad = model.triggerPad;
    const processFrame = model.processFrame;
    if (typeof triggerPad !== "function" || typeof processFrame !== "function" || !project.pads.length) {
      throw new Error("Sampler contract cannot run its pad fixture.");
    }
    triggerPad(project.pads[0].midiNote);
    const output = processFrame();
    if (!Number.isFinite(output)) throw new Error("Sampler fixture returned a non-finite sample.");
    return `Focused simulation: pad ${project.pads[0].midiNote} triggered (${project.pads.length} pads available).`;
  }
  if (project.kind === "sequencer") {
    const eventsAtStep = model.eventsAtStep;
    if (typeof eventsAtStep !== "function") throw new Error("Sequencer contract is missing eventsAtStep().");
    const events = eventsAtStep(0);
    if (!Array.isArray(events)) throw new Error("Sequencer fixture returned invalid events.");
    return `Focused simulation: ${events.length} event(s) at step 1 of ${project.sequence.stepsPerBar}.`;
  }
  if (project.kind === "mixer") {
    const mix = model.mix;
    if (typeof mix !== "function") throw new Error("Mixer contract is missing mix().");
    const inputs = Object.fromEntries(project.mixer.channels.map((channel, index) => [channel.id, [0.5 / (index + 1), 0.3 / (index + 1)]]));
    const result = mix(inputs);
    if (!Array.isArray(result) || !result.length || result.some(sample => !Number.isFinite(sample))) {
      throw new Error("Mixer fixture returned invalid audio frames.");
    }
    return `Focused simulation: mixed frame peak ${Math.max(...result.map(sample => Math.abs(Number(sample)))).toFixed(3)}.`;
  }
  if (project.kind === "utility") {
    const observe = model.observe;
    if (typeof observe !== "function") throw new Error("Utility contract is missing observe().");
    const result = observe(0.5);
    if (!result || typeof result !== "object") throw new Error("Utility fixture returned invalid meter data.");
    const { peak, rms } = result as { peak?: number; rms?: number };
    if (!Number.isFinite(peak) || !Number.isFinite(rms)) throw new Error("Utility fixture returned non-finite meter data.");
    return `Focused simulation: peak ${peak!.toFixed(3)}, RMS ${rms!.toFixed(3)}.`;
  }
  if (project.kind === "daw") return `Focused simulation: ${project.workstation.tracks} workstation tracks validated.`;
  throw new Error("This project kind does not use a focused simulation.");
}