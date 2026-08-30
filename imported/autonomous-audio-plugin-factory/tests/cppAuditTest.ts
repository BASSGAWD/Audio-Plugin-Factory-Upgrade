/**
 * The C++ Real-Time Safety Auditor (Milestone 5, native export path):
 *
 *  1. A clean translated DSP core (pure arithmetic on the Params struct) is
 *     real-time-safe and scores 100.
 *  2. The auditor CATCHES every hot-path hazard a local model might slip into
 *     the translated C++: new/delete, malloc, heap containers, locks, file &
 *     network IO, logging, sleeps, exceptions.
 *  3. It does NOT false-positive on the safe idioms real JUCE DSP uses
 *     (fixed C arrays, std::tanh/std::abs/std::sqrt, member state).
 *  4. The full-file check confirms processBlock declares ScopedNoDenormals —
 *     and the factory's OWN generated processBlock passes it.
 */
import { auditCppRealtimeSafety } from "../src/utils/cppAudit";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/* ---- 1. Clean translated core scores 100 ---- */
const cleanCore = `
float drive = params.drive;
mLp += 0.002f * (params.tone - mLp);
float g = std::pow(10.0f, drive / 20.0f);
float wet = std::tanh(inputSample * g) / std::pow(g, 0.65f);
float y = std::tanh(inputSample * (1.0f - params.mix) + wet * params.mix);
return y;`;
const clean = auditCppRealtimeSafety(cleanCore, "core");
check("clean DSP core is real-time-safe and scores 100", clean.score === 100 && clean.realtimeSafe, `score=${clean.score} findings=${clean.findings.map((f) => f.message).join(" | ")}`);

/* ---- 2. Catches real hot-path hazards ---- */
const hazard = (label: string, code: string) => {
  const r = auditCppRealtimeSafety(code, "core");
  check(`catches ${label}`, !r.realtimeSafe && r.score < 100, `score=${r.score}`);
};
hazard("new/delete", "float* buf = new float[1024]; return buf[0];");
hazard("malloc", "float* p = (float*) malloc(256 * sizeof(float)); return *p;");
hazard("heap container", "std::vector<float> scratch(512); return scratch[0];");
hazard("mutex lock", "std::lock_guard<std::mutex> lock(mMutex); return inputSample;");
hazard("file IO", "std::ofstream f(\"/tmp/log.txt\"); return inputSample;");
hazard("network IO", "int s = socket(AF_INET, SOCK_STREAM, 0); return inputSample;");
hazard("blocking sleep", "std::this_thread::sleep_for(std::chrono::milliseconds(1)); return inputSample;");

const logging = auditCppRealtimeSafety("printf(\"%f\\n\", inputSample); return inputSample;", "core");
check("flags logging (warning, not necessarily critical)", logging.findings.some((f) => /log/i.test(f.message)) && logging.score < 100);

const exc = auditCppRealtimeSafety("try { return risky(inputSample); } catch (...) { return 0.0f; }", "core");
check("flags exceptions in the audio path", exc.findings.some((f) => /exception/i.test(f.message)));

/* ---- 3. No false positives on safe JUCE idioms ---- */
const safeIdioms = `
float delayLine[1024];
int idx = mWrite & 1023;
delayLine[idx] = inputSample;
float wet = std::sqrt(std::abs(mEnv)) * std::tanh(inputSample);
mEnv = mEnv * 0.99f + inputSample * inputSample * 0.01f;
return wet;`;
const safe = auditCppRealtimeSafety(safeIdioms, "core");
check("no false positive on fixed arrays + std::tanh/abs/sqrt", safe.score === 100, `score=${safe.score} findings=${safe.findings.map((f) => f.message).join(" | ")}`);

const stringInComment = auditCppRealtimeSafety("// allocate nothing here; no new or malloc\nreturn inputSample * params.gain;", "core");
check("ignores hazard words in comments/strings", stringInComment.score === 100, `findings=${stringInComment.findings.map((f) => f.message).join(" | ")}`);

/* ---- 4. Full-file ScopedNoDenormals check ---- */
const goodProcessBlock = `
void FooAudioProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;
    Params params;
    for (int ch = 0; ch < buffer.getNumChannels(); ++ch) {
        auto* data = buffer.getWritePointer(ch);
        for (int i = 0; i < buffer.getNumSamples(); ++i)
            data[i] = mCore.processSample(data[i], params);
    }
}`;
check("factory's generated processBlock is real-time-safe", auditCppRealtimeSafety(goodProcessBlock, "full").score === 100);

const noDenormals = goodProcessBlock.replace("juce::ScopedNoDenormals noDenormals;", "");
const missing = auditCppRealtimeSafety(noDenormals, "full");
check("full-file audit flags a missing ScopedNoDenormals", missing.findings.some((f) => /ScopedNoDenormals/.test(f.message)));

/* ---- the passthrough fallback core is trivially safe ---- */
const passthrough = "// passthrough placeholder\nreturn inputSample;";
check("passthrough fallback core is real-time-safe", auditCppRealtimeSafety(passthrough, "core").score === 100);

console.log(failures === 0 ? "\nCPP AUDIT: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
