# Autonomous Audio Plugin Factory

Describe any audio plugin in plain English — a shimmer reverb, a high-gain
metal amp, a drum-pad sampler, "an EQ where each band saturates", or something
that matches no category at all — and the factory compiles it into a working,
playable plugin with a polished UI, verified DSP, and exportable Faust/JUCE
code.

## How generation works

Every request goes through the same spec-first pipeline, online or offline:

1. **Intent spec** (`src/utils/pluginSpec.ts`) — a deterministic classifier
   separates what the plugin should *look* like from what it must *do* to the
   audio, so hybrid ideas never collapse into the closest common category.
2. **Recipe references** (`src/utils/dspRecipes.ts`) — 10 golden, gate-verified
   DSP implementations (reverb, delay, modulation, dynamics, eq, filter,
   distortion, sampler, pitch, synth) guide code generation; hybrids compose
   two.
3. **Quality gate** (`src/utils/qualityGate.ts`) — every generated plugin is
   measured on real musical material (gain staging, stability at knob
   extremes, per-knob audibility) and deterministically repaired and polished.
   Nothing loads unless it scores ≥97 across looks / performance / latency /
   musicality.

The **offline builder** (`src/utils/offlineBuilder.ts`) guarantees the app
works with zero API keys: any prompt compiles locally through the same
classifier and recipe library, hybrids compose two verified stages, and
prompts matching no known family get a drive → tone → space character chain
voiced from your wording ("dark", "huge", "subtle", …). You can also tweak the
loaded plugin conversationally: "make it brighter", "more feedback", "drier".

## Honest capability limits

The engine runs per-sample JavaScript in an AudioWorklet. It has **no audio
file playback** — a "sampler" is 8 synthesized pad voices, never a loader for
your own samples. Generated plugins say so instead of pretending otherwise.

Pitch correction *is* real: autocorrelation F0 detection (with parabolic
sub-lag interpolation) → key/scale snapping → formant-preserving
resynthesis. It is **monophonic** — it tracks one fundamental in roughly the
80 Hz – 1 kHz vocal range and cannot follow chords — and it corrects to a few
cents rather than perfectly. Measured on the golden recipe: a note pushed 45
cents sharp lands 5 cents off (89% of the error removed).

## Run locally

Prerequisites: Node.js 18+.

```bash
npm install
npm run dev        # http://localhost:3000
```

Works out of the box with no configuration — the offline compiler handles all
generation. For richer LLM-driven builds, add any of:

- **Gemini (cloud)**: copy `.env.example` to `.env.local` and set
  `GEMINI_API_KEY`.
- **Ollama / LM Studio (local)**: point the app at your local server from the
  Memory & LLMs tab in the UI — no key needed.

## Scripts

```bash
npm run dev      # dev server (tsx server.ts + Vite)
npm run build    # production build (vite build + esbuild server bundle)
npm start        # run the production bundle
npm run lint     # TypeScript type check
npm test         # regression suite (30 suites, pure functions + SSR markup)
npm run test:e2e # real-browser smoke test (needs `npm run dev` already running)
```

## Testing

`npm test` runs the quality contract: every recipe, every offline/primitive
build path, and the job-graph planner is pushed through the quality gate and
must score ≥97 on all four dimensions; intent classification (including
hybrid splitting), family coverage, model-output normalization, and control
math are asserted too. Any new recipe or generation path must pass the gate
**before** it ships. These 30 suites run pure functions and SSR markup only —
no browser, no server.

Measurement suites carry a stricter bar than "a number came out". Each one
also scores a **deliberately broken** counterpart — a knob wired to nothing,
a 2x-miscalibrated delay time, a frozen LFO, an EQ with its Low and High
bands crossed — and asserts a decisive gap. A measurement that scores the
honest and broken builds the same is not measuring anything.

`npm run test:e2e` is the one suite that drives the actual running app in a
real (headless) browser via Playwright: builds a plugin through the chat UI,
verifies the generative faceplate and controls render, presses play, checks
Pro mode loads, and asserts no unexpected console errors. It needs
`npm run dev` running first and saves screenshots to
`tests/.e2e-screenshots/` for visual review.

## Export

Faust and C++/JUCE code are generated lazily when the Export tab opens, with
deterministic scaffolds from `src/utils/portableCodegen.ts` as an instant
fallback. The Native Build panel (`server/nativeBuild.ts`) drives local
plugin builds when a toolchain is available.

## JUCE desktop studio scaffold

`desktop/` is a minimal JUCE 7/CMake standalone studio source package. It is
not a signed or notarized installer. It opens and saves `.ojdaw` directory
bundles containing the unchanged canonical DawProject v3 `project.json` and
ID-addressed files below `assets/`. The browser-side dependency-free bundle
contract is in `src/daw/portableBundle.ts`.

```bash
npm run desktop:golden
npm run desktop:configure
npm run desktop:build
ORANGEJUCE_STUDIO_BIN=/absolute/path/to/OrangeJUCEStudio npm run desktop:golden:native
ORANGEJUCE_STUDIO_BIN=/absolute/path/to/OrangeJUCEStudio npm run desktop:latency -- --project /absolute/session.ojdaw --seconds 30
```

The native device report uses the active driver's real sample rate, block
size, input/output latency and xrun counter (when exposed), plus measured
callback deadline misses. See `desktop/results.md` for tolerances and required
evidence. The latency callback runs the loaded canonical project graph; a
project argument is mandatory, and no-device runs fail closed. Universal
generated-DSP parity is intentionally not claimed: native playback accepts only
the versioned `generated.gain/v1` and `generated.ducker/v1` adapters. Browser
export and native loading reject sessions with any other enabled processor,
rather than bypassing it or substituting invented DSP.
