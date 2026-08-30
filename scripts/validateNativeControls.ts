import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  NativeParameter,
  scaffoldNativeProject,
} from "../server/nativeBuild";
import { AudioPlugin } from "../src/types";
import { repairResolvedGeometry, resolveSemanticUiContract } from "../src/utils/semanticUi";

const controls: Array<NativeParameter & { controlType: string }> = [
  { id: "knob", name: "Knob", min: 0, max: 1, defaultValue: 0.5, controlType: "knob" },
  { id: "slider", name: "Slider", min: 0, max: 1, defaultValue: 0.5, controlType: "slider" },
  { id: "number", name: "Number", min: 0, max: 10, defaultValue: 5, controlType: "number" },
  { id: "toggle", name: "Toggle", min: 0, max: 1, defaultValue: 1, controlType: "toggle" },
  { id: "button", name: "Button", min: 0, max: 1, defaultValue: 0, controlType: "button" },
  { id: "pad", name: "Pad", min: 0, max: 1, defaultValue: 0, controlType: "pad" },
  { id: "select", name: "Select", min: 0, max: 2, defaultValue: 0, controlType: "select", choices: ["A", "B", "C"] },
  { id: "meter", name: "Meter", min: -60, max: 0, defaultValue: -12, controlType: "meter" },
  { id: "eq", name: "EQ", min: 0, max: 1, defaultValue: 0.5, controlType: "eq" },
  { id: "waveform", name: "Waveform", min: 0, max: 1, defaultValue: 0.5, controlType: "waveform" },
  { id: "label", name: "Label", min: 0, max: 1, defaultValue: 0, controlType: "label" },
  { id: "amp", name: "Amp", min: 0, max: 1, defaultValue: 0.5, controlType: "amp" },
  { id: "cab", name: "Cab", min: 0, max: 1, defaultValue: 0.5, controlType: "cab" },
  { id: "mic", name: "Mic", min: 0, max: 1, defaultValue: 0.5, controlType: "mic" },
  { id: "mic_stand", name: "Mic Stand", min: 0, max: 1, defaultValue: 0.5, controlType: "mic_stand" },
];

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n[native-controls] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) {
    throw new Error(`Could not start ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`${command} failed with exit code ${result.status}`);
  }
}

async function main(): Promise<void> {
  const cmake = spawnSync("cmake", ["--version"], { encoding: "utf8" });
  if (cmake.error?.message.includes("ENOENT")) {
    throw new Error("cmake is required for native control validation but was not found on PATH.");
  }
  if (cmake.status !== 0) {
    throw new Error(`cmake is unavailable: ${cmake.stderr || cmake.error?.message || "unknown error"}`);
  }

  // Compile the real identity-aware path, not just legacy metadata. Geometry
  // repair mirrors the quality gate so the validated contract is complete.
  const identitySource: AudioPlugin = {
    id: "native-control-identity-fixture", name: "Full Control Vocabulary",
    category: "distortion", family: "amp_sim", description: "", faustCode: "", cppJuceCode: "",
    createdAt: "2025-01-01T00:00:00.000Z", dspFunction: "return inputSample;",
    buildReport: { attributes: ["vintage"] } as any,
    parameters: controls.map((p) => ({ ...p, unit: p.unit || "", value: p.defaultValue, controlType: p.controlType as any })) as any,
  };
  identitySource.parameters = repairResolvedGeometry(identitySource.parameters).parameters;
  identitySource.resolvedUi = resolveSemanticUiContract(identitySource, [], "amp_sim");
  const scaffold = await scaffoldNativeProject(
    {
      name: identitySource.name,
      category: identitySource.category,
      family: identitySource.family,
      parameters: controls,
      dspFunction: identitySource.dspFunction,
      resolvedUi: identitySource.resolvedUi,
    },
    {
      provider: "ollama",
      ollamaUrl: "http://127.0.0.1:1",
      ollamaModel: "compile-fixture",
      lmStudioUrl: "http://127.0.0.1:1",
      lmStudioModel: "compile-fixture",
    },
  );
  const buildDir = path.join(scaffold.projectDir, "build-control-validation");

  try {
    run("cmake", ["-S", scaffold.projectDir, "-B", buildDir, "-DCMAKE_BUILD_TYPE=Release"], scaffold.projectDir);
    // The base target compiles the generated shared code, including every
    // generated editor source, without spending time linking a VST3 bundle.
    run("cmake", ["--build", buildDir, "--target", scaffold.projectName, "--parallel", "2"], scaffold.projectDir);
    console.log(`\nNATIVE CONTROL COMPILE: ALL ${controls.length} CONTROL TYPES PASS`);
  } finally {
    if (process.env.KEEP_NATIVE_CONTROL_FIXTURE !== "1") {
      fs.rmSync(scaffold.projectDir, { recursive: true, force: true });
    } else {
      console.log(`[native-controls] Kept fixture at ${scaffold.projectDir}`);
    }
  }
}

main().catch((error) => {
  console.error(`\nNATIVE CONTROL COMPILE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});