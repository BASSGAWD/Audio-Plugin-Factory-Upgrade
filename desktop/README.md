# OrangeJUCE Studio desktop releases

It opens and saves portable `.ojdaw` **directories** containing the unchanged
canonical `DawProject` v3 `project.json` plus `assets/<asset-id>.<extension>`.

Tagged releases publish one-click, signed and notarized macOS DMGs for Apple
Silicon and Intel, a signed Windows x64 installer, and Linux x64 DEB and TGZ
packages. Each release includes `SHA256SUMS`, a JSON build manifest, and GitHub
artifact provenance attestations. macOS and Windows release jobs fail rather
than publishing unsigned artifacts when signing credentials are unavailable.

## Supported systems and drivers

| Package | Supported system | Native audio backend |
|---|---|---|
| macOS DMG | macOS 13 or later, Intel or Apple Silicon | CoreAudio |
| Windows installer | Windows 10/11 x64 | WASAPI; ASIO only in builds explicitly compiled with a properly licensed Steinberg ASIO SDK |
| Linux DEB/TGZ | 64-bit Debian/Ubuntu-family Linux | ALSA |

The Linux TGZ is a portable package for distributions that do not consume DEB
files; system libraries listed by the DEB package must still be installed.
The Windows executable statically links the MSVC runtime, so musicians do not
need to install a separate Visual C++ Redistributable.
Hardware-specific latency and xrun proof remains separate from installer smoke
testing because hosted release runners do not expose musicians' audio devices.
The fail-closed real-interface procedure and thresholds are documented in
[`hardware-latency/README.md`](hardware-latency/README.md).

## Release verification

Every packaged artifact is installed or mounted on its target runner. The
packaged executable must launch in command mode, render the canonical native
golden fixture, react to a graph mutation, open and save a real `.ojdaw`
directory with byte-identical WAV assets, and reject an unsupported processor.
Windows Authenticode and macOS code-signing/notarization are verified after
packaging. The release is published only after every platform passes.

To verify a downloaded file, obtain `SHA256SUMS` from the same release and run:

```sh
sha256sum -c SHA256SUMS
```

Release maintainers trigger `.github/workflows/desktop-release.yml` from a tag
named `orangejuce-studio-vX.Y.Z`. Apple and Windows certificate material is
stored only as encrypted repository secrets; it is never committed to source.
Release actions and JUCE source are pinned to immutable commits. The manifest
records the source commit, source timestamp, runner, and platform toolchain
identities; signed and notarized outputs are expected to differ because trusted
timestamps are part of their signatures.

Build with CMake 3.22+, a C++20 compiler, and network access for JUCE:

```sh
cmake -S desktop -B desktop/build -DCMAKE_BUILD_TYPE=Release
cmake --build desktop/build --config Release
```

The audio callback uses JUCE's native device manager. The status view reports
driver input/output latency in samples converted using the active sample rate,
driver xruns where supported, and callback-deadline overruns. No value is
fabricated when the driver does not expose an xrun count.

## Validation boundary

The graph order is the v3 browser/offline order: track inserts, pre/post-fader
sends, track gain/pan, return inserts/gain/pan, then master inserts/gain/pan.
Sidechain detectors read the source track before destination inserts, and
automation is evaluated at project time. Generated C++ processors plug into
the insert boundary. The scaffold currently executes the versioned
`generated.gain/v1` and `generated.ducker/v1` adapters. Sessions containing an
enabled unknown or unported JavaScript processor are rejected before playback
rather than being opened with silently altered sound.
Bundle audio is decoded during project preparation and clips are scheduled in
the callback; armed tracks additionally receive live device input. No file IO,
decoding, vector growth, or lock acquisition occurs in the callback. Therefore
parity is claimed only for processors included in a golden test, never for
arbitrary model-translated DSP.

Run `npm run desktop:golden` for the dependency-free format/reference gate.
Set `ORANGEJUCE_STUDIO_BIN` and run `npm run desktop:golden:native` only after
building the native target. That gate passes the fixture path to the actual
project parser/graph and repeats with a mutated master gain, so a hardcoded or
disconnected renderer cannot pass. See `desktop/results.md` for status.