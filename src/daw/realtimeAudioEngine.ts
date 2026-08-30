import type { AudioClip, AutomationLane, DawProject, PluginInstance } from "./model";
import { buildSchedule, TransportClock } from "./scheduler";
import { validateSidechainRoute } from "./audioGraph";
import type { PluginProcessor } from "./bounce";
import { evaluateAutomation } from "./automation";

export interface DecodedAsset { channels: Float32Array[]; frames: number; sampleRate: number; duration: number }
export interface EngineMeter { level: number; peak: number }
export interface EngineMeters { tracks: Record<string, EngineMeter>; buses: Record<string, EngineMeter> }
export interface RealtimeAudioEngineOptions {
  resolveAsset(assetId: string): Promise<DecodedAsset>;
  onPosition?(position: number): void;
  onMeters?(meters: EngineMeters): void;
  onStatus?(message: string): void;
  onPlayingChange?(playing: boolean): void;
  processPlugin?: PluginProcessor;
  /** Testable injection; production uses the browser AudioContext. */
  createContext?: () => AudioContext;
}

/** Browser graph owner. Its scheduling and graph lifetime do not depend on React renders. */
export class RealtimeAudioEngine {
  private context: AudioContext | null = null;
  private clock: TransportClock | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private meterNodes = new Map<string, AnalyserNode>();
  private meterPeaks = new Map<string, number>();
  private graphNodes: AudioNode[] = [];
  private pluginInputs = new Map<string, ScriptProcessorNode>();
  private preloadedAssets = new Map<string, DecodedAsset>();
  private project: DawProject | null = null;
  private playing = false;
  private frame = 0;
  private loopTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly options: RealtimeAudioEngineOptions) {}
  get isPlaying() { return this.playing; }

  async play(project: DawProject, position: number): Promise<void> {
    if (this.playing) { this.pause(); return; }
    if (!project.tracks.some((track) => track.clips.length)) throw new Error("Import or record audio before playback.");
    this.project = structuredClone(project);
    const context = this.context ?? this.options.createContext?.() ?? new AudioContext();
    this.context = context;
    await context.resume();
    const end = project.transport.loop.enabled ? project.transport.loop.end : this.duration(project);
    // Decoding is deliberately completed before clock anchoring. Otherwise an
    // asset that takes longer to decode than its offset would begin late.
    await this.preload(project, position, end);
    if (project.transport.loop.enabled) await this.preload(project, project.transport.loop.start, project.transport.loop.end);
    const countInSeconds = this.countInSeconds(project);
    const startAt = context.currentTime + countInSeconds + .05;
    this.clock = new TransportClock(context.sampleRate);
    this.clock.play(startAt, position);
    this.playing = true;
    this.options.onPlayingChange?.(true);
    this.buildAndSchedule(this.project, position, startAt, end);
    if (countInSeconds) this.scheduleCountIn(this.project, context.currentTime, countInSeconds);
    this.watch();
    this.options.onStatus?.(countInSeconds ? `Count-in: ${project.transport.countInBars} bar${project.transport.countInBars === 1 ? "" : "s"}` : "Playing");
  }

  pause() {
    if (this.context && this.clock) this.clock.pause(this.context.currentTime);
    this.stopSources();
    this.playing = false;
    this.options.onPlayingChange?.(false);
    this.stopWatch();
    this.options.onStatus?.("Paused");
  }
  stop() {
    this.stopSources();
    this.clock?.stop();
    this.playing = false;
    this.options.onPlayingChange?.(false);
    this.stopWatch();
    this.options.onPosition?.(0);
    this.options.onStatus?.("Stopped");
  }
  async close() { this.stop(); await this.context?.close(); this.context = null; }

  private buildAndSchedule(project: DawProject, from: number, startAt: number, end = project.transport.loop.enabled ? project.transport.loop.end : this.duration(project)) {
    const context = this.context!;
    this.stopSources();
    this.graphNodes.forEach((node) => { try { node.disconnect(); } catch { /* disconnected */ } });
    this.graphNodes = []; this.meterNodes.clear(); this.pluginInputs.clear();
    const master = project.buses.find((bus) => bus.kind === "master");
    if (!master) throw new Error("Project has no master bus");
    const masterGain = this.busChain(master.id, master.gain, master.pan, master.inserts, project, from, startAt, context.destination);
    const returns = new Map<string, AudioNode>();
    for (const bus of project.buses.filter((item) => item.kind === "return")) {
      returns.set(bus.id, this.busChain(bus.id, bus.gain, bus.pan, bus.inserts, project, from, startAt, masterGain));
    }
    const anySolo = project.tracks.some((track) => track.solo);
    const trackInputs = new Map<string, GainNode>();
    for (const track of project.tracks) {
      const input = context.createGain(); input.gain.value = (!track.mute && (!anySolo || track.solo)) ? 1 : 0;
      trackInputs.set(track.id, input); this.graphNodes.push(input);
      let postInsert: AudioNode = input;
      for (const insert of track.inserts.filter((item) => item.enabled)) {
        const adapter = this.pluginAdapter(insert, project, from, startAt);
        postInsert.connect(adapter); postInsert = adapter; this.graphNodes.push(adapter);
      }
      for (const send of track.sends) {
        const destination = returns.get(send.busId);
        if (destination) {
          const tap = context.createGain(); tap.gain.value = send.gain;
          (send.preFader ? input : postInsert).connect(tap).connect(destination); this.graphNodes.push(tap);
        }
      }
      const fader = context.createGain(); const pan = context.createStereoPanner();
      this.applyAutomation(fader.gain, track.gain, project.automation, "track", track.id, "gain", from, startAt);
      this.applyAutomation(pan.pan, track.pan, project.automation, "track", track.id, "pan", from, startAt);
      postInsert.connect(fader).connect(pan).connect(masterGain); this.graphNodes.push(fader, pan);
      this.attachMeter(`track:${track.id}`, pan);
    }
    this.attachMeter(`bus:${master.id}`, masterGain);
    for (const route of project.routes.filter((item) => item.enabled)) {
      if (validateSidechainRoute(project, route).length) continue;
      const source = trackInputs.get(route.sourceTrackId);
      const destination = this.pluginInputs.get(route.pluginInstanceId);
      if (source && destination) {
        const splitter = context.createChannelSplitter(2);
        source.connect(splitter); splitter.connect(destination, 0, 2); splitter.connect(destination, 1, 3);
        this.graphNodes.push(splitter);
      }
    }
    const schedule = buildSchedule(project, from, end, context.sampleRate);
    for (const event of schedule) {
      if (event.kind === "metronome") this.click(startAt + event.time - from, event.accent);
      if (event.kind === "clip-start" && event.trackId && event.clipId) {
        const track = project.tracks.find((item) => item.id === event.trackId);
        const clip = track?.clips.find((item) => item.id === event.clipId);
        const destination = track && trackInputs.get(track.id);
        if (clip && destination) this.scheduleClip(clip, destination, from, startAt, end);
      }
    }
    if (project.transport.loop.enabled && end > from) {
      this.loopTimer = setTimeout(() => {
        if (!this.playing || !this.project || !this.context) return;
        const loop = this.project.transport.loop;
        this.clock?.seek(loop.start, this.context.currentTime);
        this.buildAndSchedule(this.project, loop.start, this.context.currentTime + .01, loop.end);
      }, Math.max(0, (startAt - context.currentTime + end - from) * 1000));
    }
  }

  private scheduleClip(clip: AudioClip, destination: AudioNode, from: number, startAt: number, end: number) {
      const asset = this.preloadedAssets.get(clip.assetId);
      if (!asset || !this.playing || !this.context) return;
      const buffer = this.context.createBuffer(asset.channels.length, asset.frames, asset.sampleRate);
      asset.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
      const source = this.context.createBufferSource(); const gain = this.context.createGain();
      source.buffer = buffer; source.loop = clip.loop;
      const scheduledAt = startAt + Math.max(clip.start, from) - from;
      const elapsed = Math.max(0, from - clip.start) + Math.max(0, this.context.currentTime - scheduledAt);
      const offset = clip.offset + elapsed;
      const playable = Math.min(clip.duration - elapsed, asset.duration - offset);
      if (playable <= 0) return;
      gain.gain.value = clip.gain; source.connect(gain).connect(destination);
      source.start(scheduledAt, offset, clip.loop ? undefined : playable);
      // BufferSource looping repeats source material, not an arrangement clip.
      // Explicitly stop it at the immutable scheduler boundary.
      if (clip.loop) source.stop(startAt + Math.min(clip.start + clip.duration, end) - from);
      this.sources.push(source); this.graphNodes.push(gain);
  }
  private async preload(project: DawProject, from: number, to: number) {
    const ids = new Set(buildSchedule(project, from, to, this.context!.sampleRate)
      .filter((event) => event.kind === "clip-start")
      .map((event) => project.tracks.find((track) => track.id === event.trackId)?.clips.find((clip) => clip.id === event.clipId)?.assetId)
      .filter((id): id is string => Boolean(id)));
    await Promise.all([...ids].map(async (id) => {
      if (!this.preloadedAssets.has(id)) this.preloadedAssets.set(id, await this.options.resolveAsset(id));
    }));
  }
  private busChain(id: string, gainValue: number, panValue: number, inserts: PluginInstance[], project: DawProject, from: number, at: number, destination: AudioNode) {
    const input = this.context!.createGain(), gain = this.context!.createGain(), pan = this.context!.createStereoPanner();
    let postInsert: AudioNode = input;
    for (const insert of inserts.filter((item) => item.enabled)) {
      const adapter = this.pluginAdapter(insert, project, from, at); postInsert.connect(adapter); postInsert = adapter; this.graphNodes.push(adapter);
    }
    this.applyAutomation(gain.gain, gainValue, project.automation, "bus", id, "gain", from, at);
    this.applyAutomation(pan.pan, panValue, project.automation, "bus", id, "pan", from, at);
    postInsert.connect(gain).connect(pan).connect(destination); this.graphNodes.push(input, gain, pan); return input;
  }
  private pluginAdapter(instance: PluginInstance, project: DawProject, from: number, startAt: number): AudioNode {
    const context = this.context!;
    if (!this.options.processPlugin) {
      const bypass = context.createGain(); bypass.gain.value = 1; return bypass;
    }
    const processor = context.createScriptProcessor(1024, 4, 2);
    this.pluginInputs.set(instance.id, processor);
    processor.onaudioprocess = (event) => {
      const input = event.inputBuffer, output = event.outputBuffer;
      const left = input.getChannelData(0), right = input.numberOfChannels > 1 ? input.getChannelData(1) : left;
      const keyLeft = input.numberOfChannels > 2 ? input.getChannelData(2) : undefined;
      const keyRight = input.numberOfChannels > 3 ? input.getChannelData(3) : undefined;
      const outputL = output.getChannelData(0), outputR = output.numberOfChannels > 1 ? output.getChannelData(1) : outputL;
      for (let frame = 0; frame < left.length; frame++) {
        const projectTime = Math.max(from, from + context.currentTime - startAt + frame / context.sampleRate);
        const params = { ...instance.parameters };
        for (const lane of project.automation) if (lane.enabled && lane.target.kind === "plugin" && lane.target.ownerId === instance.id) params[lane.target.parameterId] = evaluateAutomation(lane, projectTime);
        const sidechain = ((keyLeft?.[frame] ?? 0) + (keyRight?.[frame] ?? keyLeft?.[frame] ?? 0)) * .5;
        const [processedL, processedR] = this.options.processPlugin!({ ...instance, parameters: params }, left[frame], right[frame], sidechain, Math.round(projectTime * context.sampleRate), context.sampleRate);
        outputL[frame] = processedL; outputR[frame] = processedR;
      }
    };
    return processor;
  }
  private applyAutomation(param: AudioParam, value: number, lanes: AutomationLane[], kind: "track" | "bus", ownerId: string, parameterId: string, from: number, at: number) {
    const lane = lanes.find((item) => item.enabled && item.target.kind === kind && item.target.ownerId === ownerId && item.target.parameterId === parameterId);
    if (!lane) { param.setValueAtTime(value, at); return; }
    param.setValueAtTime(evaluateAutomation(lane, from), at);
    for (const point of [...lane.points].sort((a, b) => a.time - b.time)) {
      if (point.time < from) continue;
      const time = at + point.time - from;
      if (point.curve === "step") param.setValueAtTime(point.value, time);
      else if (point.curve === "exponential" && point.value > 0) param.exponentialRampToValueAtTime(point.value, time);
      else param.linearRampToValueAtTime(point.value, time);
    }
  }
  private attachMeter(id: string, input: AudioNode) {
    const analyser = this.context!.createAnalyser(); analyser.fftSize = 512; input.connect(analyser); this.meterNodes.set(id, analyser); this.meterPeaks.set(id, 0);
  }
  private watch = () => {
    if (!this.playing || !this.context || !this.clock || !this.project) return;
    const position = this.clock.positionAt(this.context.currentTime);
    const loop = this.project.transport.loop, end = loop.enabled ? loop.end : this.duration(this.project);
    this.options.onPosition?.(Math.min(position, end));
    const tracks: Record<string, EngineMeter> = {}, buses: Record<string, EngineMeter> = {};
    for (const [id, analyser] of this.meterNodes) {
      const samples = new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(samples);
      let sum = 0, peak = 0; for (const sample of samples) { sum += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
      const held = Math.max(peak, (this.meterPeaks.get(id) ?? 0) * .96); this.meterPeaks.set(id, held);
      const target = { level: Math.sqrt(sum / samples.length), peak: held }; (id.startsWith("track:") ? tracks : buses)[id.slice(id.indexOf(":") + 1)] = target;
    }
    this.options.onMeters?.({ tracks, buses });
    if (!loop.enabled && position >= end) this.stop(); else this.frame = requestAnimationFrame(this.watch);
  };
  private stopSources() { this.sources.forEach((source) => { try { source.stop(); } catch { /* ended */ } }); this.sources = []; if (this.loopTimer) clearTimeout(this.loopTimer); this.loopTimer = null; }
  private stopWatch() { cancelAnimationFrame(this.frame); this.frame = 0; }
  private duration(project: DawProject) { return Math.max(0, ...project.tracks.flatMap((track) => track.clips.map((clip) => clip.start + clip.duration))); }
  private countInSeconds(project: DawProject) { const tempo = project.transport.tempo[0]; return project.transport.countInBars && tempo ? project.transport.countInBars * tempo.numerator * 60 / tempo.bpm * (4 / tempo.denominator) : 0; }
  private scheduleCountIn(project: DawProject, at: number, duration: number) { const tempo = project.transport.tempo[0]; if (!tempo) return; const beat = 60 / tempo.bpm * (4 / tempo.denominator); for (let time = 0, i = 0; time < duration; time += beat, i++) this.click(at + time, i % tempo.numerator === 0); }
  private click(time: number, accent = false) { const context = this.context!; const oscillator = context.createOscillator(), gain = context.createGain(); oscillator.frequency.value = accent ? 1760 : 880; gain.gain.setValueAtTime(.12, time); gain.gain.exponentialRampToValueAtTime(.0001, time + .04); oscillator.connect(gain).connect(context.destination); oscillator.start(time); oscillator.stop(time + .05); this.sources.push(oscillator); }
}