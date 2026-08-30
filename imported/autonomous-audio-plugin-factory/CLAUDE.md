# Working on this project

Claude Code loads this file automatically. It exists mainly so a **cloud or
phone session** (claude.ai/code) doesn't burn time attempting things that
structurally cannot work there.

## Where this session is running changes what you can verify

This repo is developed on a Windows machine with a local GPU, local LLM
servers, and audio hardware. A cloud sandbox has **none of those** and no
network route back to them.

### Works anywhere (local, cloud, phone)

This is the majority of the codebase and the right place to do most work.

- **The whole deterministic build path.** `buildOfflinePlugin()` compiles any
  prompt with **zero API keys and zero LLM** — through the same classifier,
  recipes, topologies, and quality gate the online path uses.
- **The full regression suite** — pure Node/`tsx`, no browser, no server:
  ```bash
  npx tsx tests/runAll.ts     # all suites; must be 100% green before shipping
  npx tsc --noEmit            # typecheck
  ```
- **The quality gate and every measurement in it** (musicality, semantics,
  functional fitness, code audit, true peak, stereo). All of it is offline
  DSP math over synthesized test signals.
- Reading, refactoring, planning, committing.

### Cannot work in a cloud/phone session

Don't attempt these remotely; they need the physical machine.

- **Local model generation.** Ollama / LM Studio (and the custom
  `pluginsmith` model) run on the user's own GPU. A sandbox cannot reach
  `localhost:11434` / `localhost:1234` on someone else's computer.
- **Audio preview and browser UI testing.** Needs real playback and a real
  browser session (`npm run dev`, the AudioWorklet engine, `test:e2e`).
- **Native VST3 builds.** `server/nativeBuild.ts` shells out to a local
  C++/JUCE toolchain.
- **Anything under `local-model/`** — see below.

## `local-model/` is a separate project — never commit it

`local-model/` holds the user's own llama.cpp / model-training work and
contains **multiple embedded git repositories**. It is gitignored and
excluded from `tsconfig.json` deliberately.

- **Never run `git add -A` or `git add .` in this repo.** It sweeps
  `local-model/` in, and embedded repos become broken submodule-like
  references. Always inspect `git status` and stage specific paths.
- If a typecheck suddenly reports hundreds of unrelated `TS2307` errors,
  something re-included `local-model/` — fix the scoping, don't fix the
  errors.

## The invariant that matters most

**Every shipped plugin scores ≥97 on all four headline dimensions**
(looks / performance / latency / musicality). This floor is non-negotiable
and is asserted by the test suite. Nothing may lower it.

Because those four scores saturate (nearly every correct build hits 100),
newer measurements — **functional fitness** (does the plugin do its family's
actual job?) and the code auditor — are deliberately **informational only**.
They rank candidates inside `refinementScore()` but never gate shipping.
Keep that separation when adding new measurements: measure, surface the
evidence, feed the ranking — don't move the floor.

## Verifying a change to DSP or the gate

A number that merely *exists* isn't verification. The standard used
throughout this project:

1. Measure the honest implementation.
2. Measure a **deliberately broken** counterpart (a knob wired to nothing, a
   miscalibrated time constant, a frozen LFO).
3. Assert a decisive gap between them.

A measurement that scores both the same is not measuring anything. See
`tests/functionalFitnessTest.ts` for the pattern.

**When a measurement disagrees with theory, plot the raw curve before
assuming the DSP is wrong.** Two bugs in this repo were measurement
artifacts, not DSP faults — a Goertzel probe snapping to the wrong DFT bin,
and an autocorrelation peak locking onto an octave-down subharmonic.

## Running the app (local only)

```bash
dev.bat            # Windows: frees a stale port 3000, installs deps, waits for health, opens browser
npm run dev        # or directly -- tsx server.ts + Vite in middleware mode, http://localhost:3000
```

`npm run dev` is **not** a plain Vite server; it boots Express with Vite in
middleware mode, so it takes noticeably longer to come up and prints less.
`ERR_CONNECTION_REFUSED` on a fresh start usually means a zombie process is
still holding port 3000 — `dev.bat` handles that case.
