# Hardware latency evidence protocol

ORANGEJUCE does not claim low-latency monitoring from a simulated device,
offline render, or hosted CI machine. A passing suite must run the installed
desktop executable through real ASIO, CoreAudio, and ALSA interfaces.

## Safety and preparation

Turn monitor and headphone levels down before each run: the benchmark executes
the real portable project graph and writes its output to the selected interface.
Use two representative `.ojdaw` projects containing real audio assets and only
native adapters supported by the desktop build. Use the same two project
directories on all three systems.

Set `ORANGEJUCE_STUDIO_BIN` to the installed executable, then list the exact
backend and device names reported by JUCE:

```sh
npm run desktop:devices
```

The required backends are:

- Windows 10/11 x64: `ASIO`
- macOS 13 or later: `CoreAudio`
- Debian/Ubuntu-family Linux x64: `ALSA`

JUCE disables ASIO by default. Before a Windows ASIO run, obtain the SDK under
the license selected by the release owner, then configure the desktop build
without committing the SDK:

```powershell
cmake -S desktop -B desktop/build -A x64 `
  -DORANGEJUCE_ENABLE_ASIO=ON `
  -DORANGEJUCE_ASIO_SDK_PATH="C:/path/to/ASIOSDK"
cmake --build desktop/build --config Release
```

Configuration fails if the SDK is incomplete. Do not substitute WASAPI results
for the required ASIO evidence, and do not redistribute SDK files unless the
selected Steinberg license permits it.

Create one Ed25519 collector key outside source control. Keep the private key
on the three controlled hardware runners and publish the public key beside the
evidence:

```sh
openssl genpkey -algorithm ED25519 -out collector-private.pem
openssl pkey -in collector-private.pem -pubout -out collector-public.pem
```

The local `.gitignore` excludes PEM keys and raw evidence by default. Never
commit or upload `collector-private.pem`.

## Run the matrix

For each of the two projects, run both 64- and 128-sample configurations on
each operating system. Replace the quoted backend/device names with exact
values from `desktop:devices`.

```sh
npm run desktop:latency -- \
  --project "/absolute/path/monitoring-project.ojdaw" \
  --device-type "ASIO" \
  --device "Exact interface name" \
  --sample-rate 48000 \
  --block-size 64 \
  --seconds 60 \
  --signing-key "/secure/path/collector-private.pem" \
  --output "desktop/hardware-latency/evidence/windows-project-a-64.json"
```

PowerShell uses the same arguments after `--`. Repeat with block size 128, the
second project, and the platform backend. Do not hand-edit evidence files.
Failed runs are written with `status: "fail"` and exit nonzero.

Each report records:

- operating system, architecture, selected backend, and device;
- project and executable SHA-256 hashes;
- actual sample rate and block size;
- driver-reported input/output latency in samples and milliseconds;
- measured monotonic duration, callback count, worst callback time and load,
  late callback arrivals and worst callback gap;
- graph deadline misses;
- irregular callback blocks and driver xrun delta;
- every policy assertion and its actual/expected value.

## Pass/fail policy

A run passes only when all of these remain true for at least 60 seconds:

- actual buffer size is the requested 64 or 128 samples at the requested rate;
- driver input plus output latency is at most 15 ms;
- the worst measured graph callback uses at most 80% of its deadline;
- callback coverage is at least 80% of the rate/block-size expectation;
- late callback arrivals, graph deadline misses, irregular blocks, and driver
  xruns are all zero;
- the actual device/backend match the request and platform.

An unavailable xrun counter is not silently accepted; it leaves the proof
incomplete for that interface/driver.

## Publish the suite

Place all twelve reports (three systems × two projects × two block sizes) under
one directory and run:

```sh
npm run desktop:latency:aggregate -- \
  --evidence desktop/hardware-latency/evidence \
  --public-key "/secure/path/collector-public.pem" \
  --expected-executable "win32=<sha256-from-release-manifest>" \
  --expected-executable "darwin=<sha256-from-release-manifest>" \
  --expected-executable "linux=<sha256-from-release-manifest>" \
  --output desktop/hardware-latency/results.json
```

Aggregation verifies every Ed25519 signature, rejects malformed/negative
measurements, and recomputes every assertion. It fails unless exactly twelve
reports cover the same two workload hashes at 64 and 128 samples on ASIO,
CoreAudio, and ALSA and each executable hash matches its declared release
artifact. Publish the reports, summary, public key, and release manifest
together.
Parity and low-latency claims remain conditional until that aggregate exists
and passes.