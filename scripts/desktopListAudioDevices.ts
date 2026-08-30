import { spawnSync } from "node:child_process";
import fs from "node:fs";

const executable = process.env.ORANGEJUCE_STUDIO_BIN;
if (!executable || !fs.existsSync(executable)) {
  console.error("ORANGEJUCE_STUDIO_BIN must name an installed or locally built executable.");
  process.exit(2);
}
const run = spawnSync(executable, ["--list-audio-devices"], { encoding: "utf8" });
if (run.status !== 0) {
  console.error(run.stderr || `audio-device discovery exited ${run.status}`);
  process.exit(run.status ?? 1);
}
const devices = JSON.parse(run.stdout);
if (!Array.isArray(devices)) {
  console.error("Native audio-device discovery returned an invalid response.");
  process.exit(2);
}
console.log(JSON.stringify(devices, null, 2));