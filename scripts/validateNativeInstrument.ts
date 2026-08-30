import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { scaffoldNativeProject } from "../server/nativeBuild";

function run(command: string, args: string[], cwd: string): void {
  console.log(`\n[native-instrument] ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { cwd, stdio: "inherit" });
  if (result.error) throw new Error(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${command} failed with exit code ${result.status}`);
}

async function main(): Promise<void> {
  const scaffold = await scaffoldNativeProject(
    {
      name: "Compiled MIDI Sampler",
      family: "sampler",
      category: "synthesizer",
      parameters: [{ id: "level", name: "Level", min: 0, max: 1, defaultValue: 0.5 }],
      dspFunction: "return inputSample;",
      sampler: {
        pads: [
          { id: "pad-kick", midiNote: 36, assetId: "asset-kick" },
          { id: "pad-snare", midiNote: 38, assetId: "asset-snare" },
        ],
        assets: [
          { id: "asset-kick", name: "Kick", distinctFingerprint: "fixture-kick" },
          { id: "asset-snare", name: "Snare", distinctFingerprint: "fixture-snare" },
        ],
      },
    },
    {
      provider: "ollama",
      ollamaUrl: "http://127.0.0.1:1",
      ollamaModel: "compile-fixture",
      lmStudioUrl: "http://127.0.0.1:1",
      lmStudioModel: "compile-fixture",
    },
  );
  const buildDir = path.join(scaffold.projectDir, "build-instrument-validation");
  try {
    run("cmake", ["-S", scaffold.projectDir, "-B", buildDir, "-DCMAKE_BUILD_TYPE=Release"], scaffold.projectDir);
    run("cmake", ["--build", buildDir, "--target", scaffold.projectName, "--parallel", "2"], scaffold.projectDir);
    console.log("\nNATIVE MIDI SAMPLER COMPILE: PASS");
  } finally {
    if (process.env.KEEP_NATIVE_INSTRUMENT_FIXTURE !== "1") fs.rmSync(scaffold.projectDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(`\nNATIVE MIDI SAMPLER COMPILE FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});