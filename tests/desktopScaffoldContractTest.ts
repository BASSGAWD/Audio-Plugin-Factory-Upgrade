import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertNativeProcessorSupport, NATIVE_PLUGIN_ADAPTER_IDS, unsupportedNativeProcessors } from "../src/daw/nativePluginSupport";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = fs.readFileSync(path.join(root, "desktop/Source/Main.cpp"), "utf8");
const gate = fs.readFileSync(path.join(root, "scripts/desktopNativeGate.ts"), "utf8");
const latencyWrapper = fs.readFileSync(path.join(root, "scripts/desktopLatencyBenchmark.ts"), "utf8");
const fixture = JSON.parse(fs.readFileSync(path.join(root, "tests/fixtures/desktop-v3-golden.json"), "utf8"));
const benchmarkSource = main.slice(main.indexOf("class LatencyBenchmark"), main.indexOf("class App final"));

assert.match(main, /engine\.load \(document\.project, document\.root\)/,
  "opening a bundle must prepare the callback engine");
assert.match(main, /engine\.load \(project, \{\}, fixture\.getProperty \("audio"/,
  "native golden must invoke the same parser/graph engine");
assert.match(main, /arrangementSample \(graph\.tracks\[ti\], time\)/);
assert.match(main, /sidechain \(ti, plugin\.id, raw\)/);
assert.match(main, /returns\[send\.bus\] \+= tapped \* sendGain/);
assert.match(main, /for \(const auto& bus : graph\.buses\) if \(bus\.master\)/);
assert.doesNotMatch(main, /const float source\[\].*1\.0f/s,
  "native golden may not embed the fixture output path");
assert.match(gate, /mutation\.project\.buses/);
assert.match(gate, /native graph is disconnected from fixture project/);
assert.match(main, /arguments\.indexOf \("--roundtrip"\)/);
assert.match(main, /document\.open .*arguments\[flag \+ 1\]/);
assert.match(main, /document\.save .*arguments\[flag \+ 2\]/);
assert.match(gate, /monoPcm16Wav/);
assert.match(gate, /openPortableProjectBundle/);
assert.match(gate, /asset\.byteLength = wav\.byteLength/);
assert.match(gate, /assert\.deepEqual\(fs\.readFileSync/);

assert.deepEqual(NATIVE_PLUGIN_ADAPTER_IDS, ["generated.gain/v1", "generated.ducker/v1"]);
assert.deepEqual(unsupportedNativeProcessors(fixture.project), []);
const unsupported = structuredClone(fixture.project);
unsupported.tracks[0].inserts[0].pluginId = "generated.unknown/v1";
assert.equal(unsupportedNativeProcessors(unsupported)[0].name, "Golden gain");
assert.throws(() => assertNativeProcessorSupport(unsupported),
  /Golden gain \(generated\.unknown\/v1\).*only versioned adapters/);
assert.match(main, /Unsupported enabled native plugin/);
assert.doesNotMatch(main, /fixture-gain|fixture-ducker|unsupported generated DSP is an explicit bypass/);

assert.match(main, /explicit LatencyBenchmark \(LatencyBenchmarkConfig requested\)/);
assert.match(main, /document\.open \(config\.projectDirectory\)/);
assert.match(main, /engine\.load \(document\.project, document\.root\)/);
assert.match(main, /engine\.process \(input, inputChannels, output, outputChannels, frames\)/);
assert.match(main, /--latency-benchmark requires --project <bundle-dir>, --device-type <backend>/);
assert.match(latencyWrapper, /requires --project, --device-type, --device/i);
assert.doesNotMatch(benchmarkSource, /FloatVectorOperations::clear \(output\[ch\], frames\)/,
  "latency callback must process the project graph, not only clear output");

console.log("desktopScaffoldContractTest: roundtrip, adapter rejection, graph workload, and mutation probes present");