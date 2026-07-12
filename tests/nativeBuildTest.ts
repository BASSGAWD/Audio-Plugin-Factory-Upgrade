/**
 * Native-build repair-loop tests: error extraction across compiler formats,
 * and the compile -> analyze -> fix -> recompile pipeline driven by fake
 * runners (no toolchain needed in CI). The invariant under test: with a
 * working "toolchain", the pipeline ALWAYS ends in a .vst3 — via a clean
 * pass, an LLM repair, or the clearly-flagged passthrough fallback.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { extractCompileErrors, executeBuildPipeline, BuildJob } from "../server/nativeBuild";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---------------- 1. Error extraction ---------------- */

const MSVC_LOG = `
  Building Custom Rule C:/x/CMakeLists.txt
  ProcessorCore.h
C:\\x\\Source\\dsp\\ProcessorCore.h(31,9): error C2065: 'stat': undeclared identifier [C:\\x\\build\\P.vcxproj]
C:\\x\\Source\\dsp\\ProcessorCore.h(31,9): error C2065: 'stat': undeclared identifier [C:\\x\\build\\P.vcxproj]
C:\\x\\build\\_deps\\juce-src\\modules\\juce_core\\juce_core.cpp(1,1): warning C4100: unreferenced parameter
LINK : error LNK2019: unresolved external symbol foo referenced in function bar
CMake Error at CMakeLists.txt:12 (target_link_libraries): Cannot specify link libraries
`;
const msvcErrors = extractCompileErrors(MSVC_LOG);
check("extract: finds MSVC compile, link, and cmake errors", msvcErrors.length === 3, `n=${msvcErrors.length}`);
check("extract: dedupes repeated diagnostics", msvcErrors.filter((e) => /C2065/.test(e)).length === 1);
check("extract: ProcessorCore errors sort first", /ProcessorCore\.h/.test(msvcErrors[0]));
check("extract: ignores warnings", !msvcErrors.some((e) => /C4100/.test(e)));

const GCC_LOG = `Source/dsp/ProcessorCore.h:31:9: error: 'stat' was not declared in this scope\nnote: suggested alternative`;
check("extract: GCC/Clang format", extractCompileErrors(GCC_LOG).length === 1);
check("extract: clean log yields nothing", extractCompileErrors("everything fine\nBuild succeeded.").length === 0);

/* ---------------- 2. Pipeline orchestration with fake runners ---------------- */

function makeProject(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "afct-nb-"));
  fs.mkdirSync(path.join(dir, "Source", "dsp"), { recursive: true });
  fs.writeFileSync(path.join(dir, "Source", "dsp", "ProcessorCore.h"), "// original broken core");
  return dir;
}
function makeJob(projectDir: string): BuildJob {
  return { id: "t", projectDir, status: "running", log: [], startedAt: Date.now(), attempts: 0, repairHistory: [], usedPassthroughFallback: false };
}
function fakeVst3(projectDir: string): void {
  fs.mkdirSync(path.join(projectDir, "build", "Out.vst3"), { recursive: true });
}

(async () => {
  /* a. Clean first pass -> success, no repairs */
  {
    const dir = makeProject();
    const job = makeJob(dir);
    await executeBuildPipeline(job, undefined, {
      vcvars: null,
      maxRepairs: 2,
      run: async (cmd, args, cwd, onData) => {
        if (args.includes("--build")) fakeVst3(dir);
        onData("ok\n");
        return 0;
      },
    });
    check("clean pass: success with 1 attempt", job.status === "success" && job.attempts === 1 && !!job.vst3Path, `status=${job.status} attempts=${job.attempts}`);
    check("clean pass: no repair history", job.repairHistory.length === 0 && !job.usedPassthroughFallback);
  }

  /* b. Fails once with a core error -> repair fixes it -> success */
  {
    const dir = makeProject();
    const job = makeJob(dir);
    let builds = 0;
    await executeBuildPipeline(job, undefined, {
      vcvars: null,
      maxRepairs: 2,
      run: async (cmd, args, cwd, onData) => {
        if (!args.includes("--build")) return 0; // configure ok
        builds++;
        if (builds === 1) {
          onData(`Source\\dsp\\ProcessorCore.h(9,1): error C2065: 'foo': undeclared identifier\n`);
          return 1;
        }
        fakeVst3(dir);
        return 0;
      },
      repair: async (projectDir, errors) => {
        fs.writeFileSync(path.join(projectDir, "Source", "dsp", "ProcessorCore.h"), "// fixed core");
        return `model fixed ${errors.length} error(s)`;
      },
    });
    check("repair loop: success after 1 repair", job.status === "success" && job.attempts === 2, `status=${job.status} attempts=${job.attempts}`);
    check("repair loop: history records the fix", job.repairHistory.length === 1 && /model fixed 1/.test(job.repairHistory[0]), job.repairHistory.join("|"));
    check("repair loop: core actually rewritten", fs.readFileSync(path.join(dir, "Source", "dsp", "ProcessorCore.h"), "utf8").includes("fixed core"));
    check("repair loop: no passthrough needed", !job.usedPassthroughFallback);
  }

  /* c. Repairs never help -> passthrough fallback still ships a bundle */
  {
    const dir = makeProject();
    const job = makeJob(dir);
    await executeBuildPipeline(job, undefined, {
      vcvars: null,
      maxRepairs: 2,
      run: async (cmd, args, cwd, onData) => {
        if (!args.includes("--build")) return 0;
        const core = fs.readFileSync(path.join(dir, "Source", "dsp", "ProcessorCore.h"), "utf8");
        if (/passthrough|placeholder/i.test(core)) {
          fakeVst3(dir);
          return 0; // passthrough compiles
        }
        onData(`Source\\dsp\\ProcessorCore.h(9,1): error C2065: 'foo': undeclared identifier\n`);
        return 1;
      },
      repair: async () => "useless rewrite that changes nothing",
    });
    check("fallback: still ends in success", job.status === "success" && !!job.vst3Path, `status=${job.status}`);
    check("fallback: flagged honestly", job.usedPassthroughFallback && job.repairHistory.some((r) => /passthrough/.test(r)), job.repairHistory.join("|"));
    check("fallback: used both repair passes first", job.repairHistory.filter((r) => /pass \d/.test(r)).length >= 2);
  }

  /* d. Toolchain totally broken (even passthrough fails) -> honest failure */
  {
    const dir = makeProject();
    const job = makeJob(dir);
    await executeBuildPipeline(job, undefined, {
      vcvars: null,
      maxRepairs: 0,
      run: async (cmd, args, cwd, onData) => {
        if (!args.includes("--build")) return 0;
        onData("fatal error C1083: Cannot open include file: 'JuceHeader.h'\n");
        return 1;
      },
    });
    check("broken toolchain: fails honestly", job.status === "failed" && job.usedPassthroughFallback, `status=${job.status}`);
    check("broken toolchain: log names the real problem", job.log.join("").includes("passthrough core failed"));
  }

  /* e. Configure failure -> failed without any compile attempts */
  {
    const dir = makeProject();
    const job = makeJob(dir);
    await executeBuildPipeline(job, undefined, {
      vcvars: null,
      run: async (cmd, args, cwd, onData) => {
        if (!args.includes("--build")) { onData("CMake Error: no generator\n"); return 1; }
        return 0;
      },
    });
    check("configure failure: fails before compiling", job.status === "failed" && job.attempts === 0, `attempts=${job.attempts}`);
  }

  console.log(failures === 0 ? "\nNATIVE BUILD: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
