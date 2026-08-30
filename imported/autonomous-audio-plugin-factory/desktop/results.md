# Desktop validation results

Signed installer production is defined by the fail-closed desktop release
workflow. A release is published only after target-runner signature checks and
packaged-artifact smoke gates pass; local source validation is recorded below.

| Gate | Command | Published result |
|---|---|---|
| v3 bundle contract | `npm run desktop:golden` | Pass, checked-in canonical v3 fixture |
| browser/offline golden render | `npm run desktop:golden` | Pass: max abs 8.78e-9, RMS 5.37e-9 (limits 1e-6) |
| Linux x64 native source build | `npm run desktop:configure && npm run desktop:build` | Pass on 2026-08-29 with JUCE 7.0.12 and GCC 14.3 |
| native executable golden + mutation + directory roundtrip | `npm run desktop:golden:native` | Pass locally: max abs 3.33e-7, RMS 2.36e-7, mutation max abs 3.34e-7 (limits 1e-6); valid WAV fixture roundtripped with canonical JSON and byte-identical assets; unsupported processor probe rejected |
| packaged release contract | `npx tsx tests/desktopReleaseContractTest.ts` | Enforces Windows Authenticode, Apple hardened signing/notarization, Linux packages, per-platform packaged smoke tests, provenance, and checksums |
| native device latency/xruns | `npm run desktop:latency` with explicit project, backend, device, rate, block size, duration, and output | Not published: the Replit build machine has no active native audio device; the command exits nonzero rather than publishing zero/synthetic data |

Parity is not claimed until the native executable gate and a hardware latency
run are attached with OS, device, driver, sample rate, block size, input/output
latency, callback count, and xrun count.

The hardware policy requires two portable projects at both 64 and 128 samples
for ASIO, CoreAudio, and ALSA. Every run lasts at least 60 seconds and requires
driver round-trip latency at or below 15 ms, worst callback load at or below
80%, at least 80% callback coverage, and zero late callback arrivals, deadline
misses, irregular blocks, and driver xruns. Reports must pass Ed25519 signature
verification and policy recomputation. An unavailable xrun counter fails closed. See
`desktop/hardware-latency/README.md`; no hardware result is checked in yet.

The benchmark requires and preloads a portable project, then executes its
`CanonicalEngine` graph in every device callback. Only the versioned
`generated.gain/v1` and `generated.ducker/v1` native adapters are accepted;
unsupported sessions fail before playback. Universal generated-DSP parity is
not claimed.