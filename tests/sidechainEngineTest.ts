/**
 * The sidechain-engine contract:
 *
 *  1. BACKWARD COMPATIBILITY IS ABSOLUTE — every existing module (mono,
 *     stereo/mid-side, ping-pong) behaves byte-identically whether or not a
 *     5th `inputKey` argument is supplied at all: bodies that never
 *     reference it simply ignore it, exactly like inputR before it.
 *  2. comp_sidechain_ext gates at >= 97 with zero defects.
 *  3. It is a REAL external key, not a self-detecting compressor in
 *     disguise: gain reduction tracks the KEY signal's envelope, not the
 *     main signal's -- proven by holding the main signal at a CONSTANT
 *     level and toggling only the key between loud and quiet.
 *  4. Without a key connected, it falls back to ordinary self-detecting
 *     compression (inputKey undefined -> key = inputSample), so every
 *     existing render path (gate, functional fitness, reference deviation)
 *     measures it exactly like any other compressor.
 *  5. The research loop closes: sidechain-input is no longer blocked, is
 *     approvable, and approving it makes "a sidechain compressor" build it
 *     for real.
 */
import { DSP_RECIPES } from "../src/utils/dspRecipes";
import { DSP_TOPOLOGIES } from "../src/utils/dspTopologies";
import { runQualityGate } from "../src/utils/qualityGate";
import { classifyPluginIntent, familyToCategory } from "../src/utils/pluginSpec";
import { runResearch, approveResearch, isApprovable } from "../src/utils/researchEngine";
import { buildOfflinePlugin } from "../src/utils/offlineBuilder";
import { AudioPlugin, PluginParameter } from "../src/types";
import { normalizePersistedPlugin } from "../src/utils/pluginPersistence";
import { buildFaustScaffold, buildJuceScaffold, hasDeterministicSidechainPort } from "../src/utils/portableCodegen";
import { cppFloatLiteral } from "../src/components/ExportPanel";
import { routingContractFor, sidechainRuntimeStatus, validateRoutingContract } from "../src/utils/sidechainContract";
import { scaffoldNativeProject, validateNativePlugin, findVcvars64 } from "../server/nativeBuild";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import http from "node:http";

/**
 * Resolve a working C++20 toolchain and use it to compile + run a small
 * standalone harness, then throw with the REAL compiler/linker output on
 * failure instead of silently swallowing it into a bare boolean.
 *
 * This test was authored against Replit's container, which ships g++ on
 * PATH. This repo's own dev machine has neither g++ nor cl.exe on PATH --
 * but does have MSVC on disk, reachable via vcvars64.bat exactly like
 * server/nativeBuild.ts's own findVcvars64() already solved for the real
 * native-build pipeline (see its comment: MSVC can be fully installed while
 * both PATH and the VS instance registry know nothing about it). Reuse that
 * instead of re-deriving it here.
 *
 * The MSVC step writes a temp .bat file rather than an inline
 * `cmd /c "call ... && cl ..."` string: nested quoting through cmd.exe's
 * /c argument reliably corrupts (observed live -- it silently launches an
 * interactive cmd.exe instead of running anything), while a plain script
 * file sidesteps that class of bug entirely.
 */
function compileAndRunCpp(sourcePath: string, outputBase: string): void {
  const exe = process.platform === "win32" ? `${outputBase}.exe` : outputBase;
  const errors: string[] = [];

  const describeExecError = (error: unknown): string => {
    if (error && typeof error === "object" && ("stdout" in error || "stderr" in error)) {
      const e = error as { stdout?: Buffer | string; stderr?: Buffer | string; message?: string };
      const out = [e.stdout, e.stderr].map((x) => x?.toString().trim()).filter(Boolean).join("\n");
      return out || e.message || String(error);
    }
    return error instanceof Error ? error.message : String(error);
  };

  try {
    execFileSync("g++", ["-std=c++20", "-O2", sourcePath, "-o", exe], { stdio: "pipe" });
    execFileSync(exe, [], { stdio: "pipe" });
    return;
  } catch (error) {
    errors.push(`g++: ${describeExecError(error)}`);
  }

  if (process.platform === "win32") {
    const vcvars = findVcvars64();
    if (vcvars) {
      const dir = path.dirname(sourcePath);
      const batPath = path.join(dir, `${path.basename(outputBase)}-compile.bat`);
      fs.writeFileSync(
        batPath,
        `@echo off\r\ncd /d "${dir}"\r\ncall "${vcvars}" >nul\r\ncl /nologo /std:c++20 /EHsc /O2 "${sourcePath}" /Fe:"${exe}"\r\n`
      );
      try {
        execFileSync("cmd.exe", ["/c", batPath], { stdio: "pipe" });
        execFileSync(exe, [], { stdio: "pipe" });
        return;
      } catch (error) {
        errors.push(`cl.exe via vcvars64: ${describeExecError(error)}`);
      } finally {
        fs.rmSync(batPath, { force: true });
      }
    } else {
      errors.push("cl.exe via vcvars64: no vcvars64.bat found on this machine");
    }
  }

  throw new Error(`no working C++20 compiler found for ${path.basename(sourcePath)}:\n${errors.join("\n")}`);
}

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

const mem = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
} as Storage;

const compile = (body: string) =>
  new Function("inputSample", "params", "state", "inputR", "inputKey", body) as (l: number, p: any, s: any, r?: number, k?: number) => number;
const defaults = (params: PluginParameter[]) => Object.fromEntries(params.map((p) => [p.id, p.defaultValue]));
const asPlugin = (id: string, family: any, params: PluginParameter[], body: string): AudioPlugin => ({
  id, name: id, category: familyToCategory(family), description: "",
  parameters: params.map((p) => ({ ...p, value: p.defaultValue })),
  dspFunction: body, faustCode: "", cppJuceCode: "", createdAt: "",
});

(async () => {
  /* ---- 1. Backward compatibility: an unrelated 5th arg changes nothing ---- */
  const tape = DSP_RECIPES.find((r) => r.id === "delay")!;
  {
    const fn1 = compile(tape.body);
    const fn2 = compile(tape.body);
    const s1: any = {};
    const s2: any = {};
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = Math.sin(i * 0.037) * 0.5;
      // fn1 gets no 5th arg at all; fn2 gets a wildly different key every
      // sample -- a mono body must ignore both identically.
      const y1 = fn1(x, defaults(tape.parameters as any), s1);
      const y2 = fn2(x, defaults(tape.parameters as any), s2, undefined, Math.sin(i * 1.91) * 0.9);
      if (Math.abs(y1 - y2) > 1e-12) { identical = false; break; }
    }
    check("mono delay ignores inputKey entirely (byte-identical)", identical);
  }
  const midSide = DSP_TOPOLOGIES.find((t) => t.id === "comp_midside")!;
  {
    const fn1 = compile(midSide.body);
    const fn2 = compile(midSide.body);
    const s1: any = {};
    const s2: any = {};
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = Math.sin(i * 0.041) * 0.5;
      const r = Math.sin(i * 0.029) * 0.4;
      const y1 = fn1(x, defaults(midSide.parameters as any), s1, r);
      const y2 = fn2(x, defaults(midSide.parameters as any), s2, r, Math.sin(i * 2.3) * 0.9);
      if (Math.abs(y1 - y2) > 1e-12 || Math.abs((s1.outR ?? 0) - (s2.outR ?? 0)) > 1e-12) { identical = false; break; }
    }
    check("stereo mid-side ignores inputKey entirely (byte-identical, both channels)", identical);
  }

  /* ---- 2. comp_sidechain_ext ships at the floor ---- */
  const sc = DSP_TOPOLOGIES.find((t) => t.id === "comp_sidechain_ext")!;
  check("comp_sidechain_ext exists in the topology bank", !!sc);
  const gate = runQualityGate(asPlugin("t", sc.family, sc.parameters as any, sc.body), { family: sc.family, prompt: "sidechain input from an external key" });
  const min = Math.min(gate.scores.looks, gate.scores.performance, gate.scores.latency, gate.scores.musicality);
  const defects = gate.report.deadParams.length + gate.report.unstableParams.length + (gate.report.semanticViolations?.length || 0);
  check("comp_sidechain_ext ships at the floor with zero defects", min >= 97 && defects === 0, `min=${min} defects=${defects}`);
  check("comp_sidechain_ext's body actually reads inputKey", sc.body.includes("inputKey"));

  /* ---- 3. Real ducking: gain reduction tracks the KEY, not the main signal ----
   * The key must toggle on a period long enough for the Release time
   * constant to actually settle each phase (120ms default release here) --
   * a faster toggle just measures attack/release smoothing artifacts, not
   * whether the detector is keyed correctly. Verified empirically before
   * writing this: a 1000-sample (~23ms) toggle period gave a meaningless
   * 1.03x ratio; a 10000-sample (~227ms) period, comfortably longer than
   * the release time, gives a clean, decisive result. */
  {
    const fn = compile(sc.body);
    const state: any = {};
    const params = defaults(sc.parameters as any);
    const N = 200000;
    let sumLoud = 0, nLoud = 0, sumQuiet = 0, nQuiet = 0;
    for (let i = 0; i < N; i++) {
      // Main signal: CONSTANT amplitude throughout -- if ducking is real,
      // its output level must still change with the key, not the main.
      const main = 0.5 * Math.sin((2 * Math.PI * 440 * i) / 44100);
      const keyPhaseLoud = Math.floor(i / 10000) % 2 === 0;
      const key = (keyPhaseLoud ? 0.8 : 0.01) * Math.sin((2 * Math.PI * 100 * i) / 44100);
      const out = fn(main, params, state, undefined, key);
      const phase = i % 20000;
      if (phase > 3000 && phase < 9000) { sumLoud += Math.abs(out); nLoud++; }
      if (phase > 13000 && phase < 19000) { sumQuiet += Math.abs(out); nQuiet++; }
    }
    const avgLoud = sumLoud / nLoud;
    const avgQuiet = sumQuiet / nQuiet;
    check(
      "main signal ducks when the KEY is loud, recovers when the key is quiet (main itself never changes level)",
      avgQuiet > avgLoud * 1.8,
      `avgWhenKeyLoud=${avgLoud.toFixed(4)} avgWhenKeyQuiet=${avgQuiet.toFixed(4)} ratio=${(avgQuiet / avgLoud).toFixed(2)}`
    );
  }

  /* ---- 4. No key connected -> falls back to ordinary self-detection ---- */
  {
    const fn1 = compile(sc.body);
    const fn2 = compile(sc.body);
    const s1: any = {};
    const s2: any = {};
    const params = defaults(sc.parameters as any);
    let identical = true;
    for (let i = 0; i < 4000; i++) {
      const x = (i % 8000 < 4000 ? 0.7 : 0.05) * Math.sin(i * 0.09);
      // fn1: no key arg at all. fn2: explicitly pass inputKey === inputSample
      // (the documented fallback value). Both must behave identically.
      const y1 = fn1(x, params, s1);
      const y2 = fn2(x, params, s2, undefined, x);
      if (Math.abs(y1 - y2) > 1e-9) { identical = false; break; }
    }
    check("with no key connected, behaves exactly like self-detecting compression", identical);
  }

  /* ---- 5. The research loop closes ---- */
  const research = await runResearch("sidechain-input");
  check("sidechain-input is no longer blocked", !research.conflicts.some((c) => c.severity === "blocking"));
  check("sidechain-input is approvable with a verified module", isApprovable(research) && research.proposedModule?.verification.passes === true);
  approveResearch(research.id);
  const build = buildOfflinePlugin("a sidechain compressor ducking the bass from the kick");
  check(
    "approved sidechain compressor is buildable by name",
    build.dspFunction.includes("inputKey"),
    build.description.slice(0, 90)
  );
  const builtGate = runQualityGate(
    { id: "t", name: build.name, category: build.category, description: build.description, parameters: build.parameters, dspFunction: build.dspFunction, faustCode: "", cppJuceCode: "", createdAt: "" },
    { family: build.family, prompt: "a sidechain compressor ducking the bass from the kick" }
  );
  const builtMin = Math.min(builtGate.scores.looks, builtGate.scores.performance, builtGate.scores.latency, builtGate.scores.musicality);
  check("the built sidechain compressor ships at the floor", builtMin >= 97, `min=${builtMin}`);

  /* ---- 6. Versioned classification + representative eligible families ---- */
  const plainComp = classifyPluginIntent("build a transparent bus compressor");
  check("ordinary dynamics stays internal-only", plainComp.routing.version === "1.0" && plainComp.routing.detectorMode === "internal" && !plainComp.routing.auxiliaryInput.supported);
  const sidechainComp = classifyPluginIntent("build a sidechain compressor keyed by the kick");
  check("explicit sidechain dynamics requests an optional auxiliary detector", sidechainComp.routing.detectorMode === "external-optional" && sidechainComp.routing.disconnectedBehavior === "use-internal-detector");
  const impossible = classifyPluginIntent("build a sidechain reverb");
  check("ineligible reverb does not advertise a sidechain", impossible.family === "reverb" && !impossible.routing.auxiliaryInput.supported);

  for (const prompt of [
    "build an external keyed gate for a voiceover",
    "build a dynamic EQ sidechain controlled by the kick",
    "build a sidechain filter that pumps from the drums",
  ]) {
    const generated = buildOfflinePlugin(prompt);
    const verified = runQualityGate(asPlugin(`family-${prompt}`, generated.family, generated.parameters, generated.dspFunction), { family: generated.family, prompt });
    check(`${prompt}: generated DSP consumes inputKey`, generated.dspFunction.includes("inputKey"));
    check(`${prompt}: routing contract is selected and internally consistent`, verified.plugin.routing?.auxiliaryInput.supported === true && validateRoutingContract(verified.plugin.routing, verified.plugin.dspFunction).length === 0);
    check(`${prompt}: relevant detector controls are present`, generated.parameters.some((p) => /attack|threshold|sensitivity/i.test(p.id)));
  }

  /* ---- 7. Persistence and runtime truthfulness ---- */
  const migrated = normalizePersistedPlugin({
    ...builtGate.plugin,
    routing: undefined,
  });
  check("pre-contract persisted sidechain plugins migrate to routing v1", migrated.routing?.version === "1.0" && migrated.routing.auxiliaryInput.supported);
  const repairedLie = normalizePersistedPlugin({
    ...builtGate.plugin,
    dspFunction: "return inputSample;",
    routing: builtGate.plugin.routing,
  });
  check("persisted metadata cannot advertise an unconsumed inputKey", !repairedLie.routing?.auxiliaryInput.supported);
  const editedRouting = routingContractFor("dynamics", "external sidechain compressor", "const deadKeyRead = inputKey; return inputSample;");
  check("manual DSP edits that remove key-dependent behavior revoke sidechain capability", !editedRouting.auxiliaryInput.supported && editedRouting.detectorMode === "internal");
  check("selected source is not called active before engine consumption", sidechainRuntimeStatus(builtGate.plugin, true, true, false, 0.8).mode === "external-connected");
  check("disconnected source always reports internal detection and zero meter", sidechainRuntimeStatus(builtGate.plugin, false, true, true, 0.8).mode === "internal" && sidechainRuntimeStatus(builtGate.plugin, false, true, true, 0.8).level === 0);
  check("external activity requires connected + consumed + nonzero signal", sidechainRuntimeStatus(builtGate.plugin, true, true, true, 0.5).mode === "external-active");

  /* ---- 8. Portable and generated-native parity ---- */
  const faust = buildFaustScaffold(builtGate.plugin);
  const portableJuce = buildJuceScaffold(builtGate.plugin);
  check("Faust metadata carries the optional sidechain contract", /auxiliary-sidechain=optional/.test(faust) && /process\(main, key\)/.test(faust));
  check("portable JUCE metadata carries matching channel semantics", /optional mono-or-stereo/.test(portableJuce) && /use-internal-detector/.test(portableJuce));
  let rejectedMismatch = false;
  try {
    validateNativePlugin({ name: "Lie", parameters: [], dspFunction: "return inputSample;", routing: builtGate.plugin.routing });
  } catch {
    rejectedMismatch = true;
  }
  check("native boundary rejects advertised sidechains the DSP cannot consume", rejectedMismatch);

  const scaffold = await scaffoldNativeProject(
    {
      name: "Contract Sidechain",
      category: builtGate.plugin.category,
      family: builtGate.plugin.family,
      parameters: builtGate.plugin.parameters,
      dspFunction: builtGate.plugin.dspFunction,
      routing: builtGate.plugin.routing,
    },
    { provider: "ollama", ollamaUrl: "http://127.0.0.1:1", ollamaModel: "none", lmStudioUrl: "http://127.0.0.1:1", lmStudioModel: "none" }
  );
  const nativeCpp = fs.readFileSync(path.join(scaffold.projectDir, "Source", "PluginProcessor.cpp"), "utf8");
  const nativeCore = fs.readFileSync(path.join(scaffold.projectDir, "Source", "dsp", "ProcessorCore.h"), "utf8");
  check("generated native project declares a disabled-by-default auxiliary bus", /withInput \("Sidechain".*false\)/.test(nativeCpp));
  check("native layout accepts only mono/stereo auxiliary channels", /aux != juce::AudioChannelSet::mono\(\).*aux != juce::AudioChannelSet::stereo\(\)/s.test(nativeCpp));
  check("native hot path falls back to main detector when aux is disconnected", /sidechainConnected[\s\S]*\? sidechainBuffer[\s\S]*: data\[i\]/.test(nativeCpp));
  const hotPath = nativeCpp.match(/void .*?::processBlock[\s\S]*?\n\}/)?.[0] || "";
  check("native sidechain hot path has no allocations, locks, logging, or UI work", !/\bnew\b|malloc|mutex|lock_guard|std::cout|MessageManager|repaint\s*\(/.test(hotPath));
  check("deterministic native fallback consumes the actual key instead of passing through", /std::abs \(inputKey\)/.test(nativeCore) && !/transparent passthrough/.test(nativeCore));
  const harnessPath = path.join(scaffold.projectDir, "sidechain_behavior.cpp");
  const harnessBinary = path.join(scaffold.projectDir, "sidechain_behavior");
  fs.writeFileSync(harnessPath, `#include "Source/dsp/ProcessorCore.h"
#include <cmath>
#include <iostream>
int main() {
  Params p; ProcessorCore quiet, loud; quiet.prepare(44100.0); loud.prepare(44100.0);
  double q = 0.0, l = 0.0;
  for (int i = 0; i < 120000; ++i) {
    float main = 0.4f * std::sin(0.071f * i);
    if (i > 20000) {
      q += std::abs(quiet.processSample(main, 0.001f, p));
      l += std::abs(loud.processSample(main, 0.9f * std::sin(0.13f * i), p));
    } else {
      quiet.processSample(main, 0.001f, p); loud.processSample(main, 0.9f * std::sin(0.13f * i), p);
    }
  }
  std::cout << q << " " << l;
  return l < q * 0.8 ? 0 : 1;
}`);
  let nativeBehavior = false;
  try {
    compileAndRunCpp(harnessPath, harnessBinary);
    nativeBehavior = true;
  } catch (error) {
    console.error(`[sidechain detector harness] ${error instanceof Error ? error.message : error}`);
  }
  check("generated native detector produces measurably different audio for loud vs quiet keys", nativeBehavior);
  const customPlugin = {
    name: "Custom Keyed",
    category: "dynamics",
    family: "dynamics",
    parameters: [{ id: "depth", name: "Depth", min: 0, max: 1, defaultValue: 0.5 }],
    dspFunction: "return inputSample * (1 - Math.min(0.9, Math.abs(inputKey) * (params.depth ?? 0.5)));",
    routing: builtGate.plugin.routing,
  } as const;
  check("custom sidechain schema is not substituted into a fixed portable JUCE algorithm", !hasDeterministicSidechainPort(customPlugin as any) && /PORT UNAVAILABLE/.test(buildJuceScaffold({ ...builtGate.plugin, ...customPlugin } as any)));
  check("custom sidechain schema is not substituted into generic Faust DSP", /FAUST PORT UNAVAILABLE/.test(buildFaustScaffold({ ...builtGate.plugin, ...customPlugin } as any)));
  let customNativeRejected = false;
  try {
    await scaffoldNativeProject(customPlugin as any, { provider: "ollama", ollamaUrl: "http://127.0.0.1:1", ollamaModel: "none", lmStudioUrl: "http://127.0.0.1:1", lmStudioModel: "none" });
  } catch (error) {
    customNativeRejected = /no substitute processor|requires a working local translation model/i.test(String(error));
  }
  check("custom sidechain native fallback fails explicitly instead of emitting substitute DSP", customNativeRejected);

  let fakeModelRequests = 0;
  const fakeModel = http.createServer((_req, res) => {
    fakeModelRequests++;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ message: { content: "const float deadKeyRead = inputKey; return inputSample;" } }));
  });
  await new Promise<void>((resolve) => fakeModel.listen(0, "127.0.0.1", resolve));
  const fakeAddress = fakeModel.address();
  const fakePort = typeof fakeAddress === "object" && fakeAddress ? fakeAddress.port : 0;
  try {
    const rejectedTranslation = await scaffoldNativeProject(builtGate.plugin as any, {
      provider: "ollama",
      ollamaUrl: `http://127.0.0.1:${fakePort}`,
      ollamaModel: "fake",
      lmStudioUrl: "",
      lmStudioModel: "",
    });
    const rejectedCore = fs.readFileSync(path.join(rejectedTranslation.projectDir, "Source", "dsp", "ProcessorCore.h"), "utf8");
    check("sidechain native generation never executes or accepts untrusted model C++", fakeModelRequests === 0 && rejectedTranslation.dspTranslated === false && /untrusted model-generated/.test(rejectedTranslation.warning ?? "") && /std::abs \(inputKey\)/.test(rejectedCore));
  } finally {
    await new Promise<void>((resolve) => fakeModel.close(() => resolve()));
  }

  const exportPanelSource = fs.readFileSync(path.join(process.cwd(), "src", "components", "ExportPanel.tsx"), "utf8");
  check("downloadable JUCE project uses its own compatible sidechain DSP interface", exportPanelSource.includes("deterministicJuceAvailable ? fullProjectSidechainCore") && exportPanelSource.includes("void processBlock(juce::AudioBuffer<float>& mainBus, const juce::AudioBuffer<float>& auxBus)"));
  check("downloadable JUCE project declares the auxiliary input disabled by default", exportPanelSource.includes('.withInput  ("Sidechain", juce::AudioChannelSet::stereo(), false)'));
  check("custom sidechain schemas cannot download a substituted full JUCE project", exportPanelSource.includes("disabled={sidechainEnabled && !deterministicJuceAvailable}") && exportPanelSource.includes("Full JUCE project unavailable: this custom sidechain DSP requires a faithful native translation."));
  check("full JUCE project formats integral parameter values as valid C++ floats", exportPanelSource.includes("cppFloatLiteral(p.min)") && exportPanelSource.includes("cppFloatLiteral(p.defaultValue)") && !exportPanelSource.includes("${p.defaultValue}f"));
  const literalHarnessPath = path.join(scaffold.projectDir, "literal-harness.cpp");
  const literalHarnessBinary = path.join(scaffold.projectDir, "literal-harness");
  fs.writeFileSync(literalHarnessPath, `int main() { constexpr float values[] = { ${[-48, 0, 8, 0.5].map(cppFloatLiteral).join(", ")} }; return values[0] < values[2] ? 0 : 1; }`);
  let fullProjectLiteralsCompile = false;
  try {
    compileAndRunCpp(literalHarnessPath, literalHarnessBinary);
    fullProjectLiteralsCompile = true;
  } catch (error) {
    console.error(`[literal harness] ${error instanceof Error ? error.message : error}`);
  }
  check("integral sidechain project parameter literals compile as C++", fullProjectLiteralsCompile);
  const appSource = fs.readFileSync(path.join(process.cwd(), "src", "App.tsx"), "utf8");
  check("plugin saves revalidate sidechain routing against the current DSP source", appSource.includes("const revalidatedPlugin") && appSource.includes("routing: routingContractFor("));

  console.log(failures === 0 ? "\nSIDECHAIN ENGINE: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
