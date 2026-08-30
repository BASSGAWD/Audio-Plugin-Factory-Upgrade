#!/usr/bin/env node
/**
 * Pull down and register OrangeJUCE's fine-tuned local model ("orangey"),
 * the app's default Ollama model (see DEFAULT_LLM_CONFIG in
 * src/utils/llmGateway.ts).
 *
 * Why this script exists: local-model/ -- where orangey was actually
 * trained -- is deliberately gitignored (it's a separate project with
 * embedded git repos; see CLAUDE.md). That means a fresh clone of this repo
 * has NO local model at all, even though the app's default config points at
 * one by name. This script is the bridge: it downloads the trained adapter
 * from Hugging Face and wires it into a fresh Ollama install, so "clone and
 * run dev.bat" actually works end to end without anyone needing to run the
 * multi-hour training pipeline themselves.
 *
 * Usage:  node scripts/setup-orangey-model.mjs
 * (dev.bat calls this automatically if the model is missing.)
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Update after running local-model/train/publish_to_hf.py -- that script
// prints the exact repo id to put here once it has uploaded.
const HF_REPO = "REPLACE_ME/orangejuce-orangey";
const ADAPTER_FILENAME = "orangey-lora-f16.gguf";
const OLLAMA_MODEL_NAME = "orangey";
const OLLAMA_BASE_MODEL = "qwen3:8b";

function ollamaHasModel(name) {
  const res = spawnSync("ollama", ["list"], { encoding: "utf-8" });
  if (res.status !== 0) return null; // Ollama not installed / not running
  return res.stdout.split("\n").some((line) => line.trim().startsWith(name));
}

function run(cmd, args, label) {
  console.log(`  [setup] ${label}...`);
  const res = spawnSync(cmd, args, { stdio: "inherit" });
  if (res.status !== 0) {
    throw new Error(`${label} failed (exit ${res.status})`);
  }
}

async function downloadAdapter(destPath) {
  const url = `https://huggingface.co/${HF_REPO}/resolve/main/${ADAPTER_FILENAME}`;
  console.log(`  [setup] downloading ${ADAPTER_FILENAME} from ${HF_REPO}...`);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(
      `Download failed: HTTP ${resp.status} from ${url}\n` +
        `If this is a fresh setup, orangey may not be published yet -- see local-model/README.md.`
    );
  }
  const buf = Buffer.from(await resp.arrayBuffer());
  writeFileSync(destPath, buf);
  console.log(`  [setup] saved ${(buf.length / 1e6).toFixed(1)} MB to ${destPath}`);
}

async function main() {
  const hasOllama = spawnSync("ollama", ["--version"], { encoding: "utf-8" }).status === 0;
  if (!hasOllama) {
    console.log("  [setup] Ollama isn't installed -- orangey requires it.");
    console.log("  [setup] Install from https://ollama.com then re-run this script.");
    process.exit(1);
  }

  if (ollamaHasModel(OLLAMA_MODEL_NAME)) {
    console.log(`  [setup] "${OLLAMA_MODEL_NAME}" is already registered with Ollama -- nothing to do.`);
    return;
  }

  if (HF_REPO.startsWith("REPLACE_ME")) {
    console.log("  [setup] orangey hasn't been published yet (HF_REPO placeholder still set).");
    console.log("  [setup] The app will fall back to whatever DEFAULT_LLM_CONFIG.ollamaModel");
    console.log("          resolves to via autoDetectProvider, or you can point Settings at");
    console.log("          any other local model in the meantime.");
    return;
  }

  if (!ollamaHasModel(OLLAMA_BASE_MODEL)) {
    run("ollama", ["pull", OLLAMA_BASE_MODEL], `pulling base model ${OLLAMA_BASE_MODEL}`);
  }

  const workDir = join(tmpdir(), "orangejuce-orangey-setup");
  mkdirSync(workDir, { recursive: true });
  const adapterPath = join(workDir, ADAPTER_FILENAME);
  if (!existsSync(adapterPath)) {
    await downloadAdapter(adapterPath);
  } else {
    console.log(`  [setup] adapter already downloaded at ${adapterPath}, reusing`);
  }

  const modelfilePath = join(workDir, "Modelfile");
  writeFileSync(
    modelfilePath,
    `FROM ${OLLAMA_BASE_MODEL}\nADAPTER ${adapterPath.replace(/\\/g, "/")}\n` +
      `PARAMETER temperature 0.6\nPARAMETER top_p 0.95\nPARAMETER top_k 20\nPARAMETER num_ctx 8192\n`
  );

  run("ollama", ["create", OLLAMA_MODEL_NAME, "-f", modelfilePath], `registering "${OLLAMA_MODEL_NAME}" with Ollama`);
  console.log(`  [setup] done -- "${OLLAMA_MODEL_NAME}" is ready.`);
}

main().catch((err) => {
  console.error(`  [setup] FAILED: ${err.message}`);
  console.error("  [setup] The app will still run with whatever local model Ollama already has.");
  process.exit(1);
});
