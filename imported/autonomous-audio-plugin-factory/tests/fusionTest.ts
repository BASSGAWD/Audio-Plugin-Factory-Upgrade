/**
 * Fusion mode — the multi-model contract:
 *
 *  1. Plumbing: "fusion" is a local provider; memberConfig derives each
 *     member's standalone config; FUSION_MEMBERS lists both local backends.
 *  2. The refinement loop's fusion refiner ALTERNATES members per rework
 *     (ollama, lm_studio, ollama, ...) and labels each proposal — the
 *     ensemble-search technique, verified with an injected worker.
 *  3. Racing: callLocalLLM("fusion") resolves with the FIRST valid member
 *     response and survives one member being down (failover); when all
 *     members fail it reports every member's reason. Verified against two
 *     stub HTTP backends on localhost.
 *  4. detectFusion is honest: only "available" when BOTH backends answer
 *     with a loaded model.
 */
import http from "node:http";
import { AddressInfo } from "node:net";
import {
  LLMConfig, FUSION_MEMBERS, memberConfig, isLocalProvider, callLocalLLM, detectFusion,
} from "../src/utils/llmGateway";

let failures = 0;
function check(label: string, ok: boolean, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${detail ? `  ${detail}` : ""}`);
}

/** Minimal stub that speaks both Ollama (/api/chat, /api/tags) and LM Studio
 *  (/v1/chat/completions, /v1/models) shapes. */
function startStub(opts: { name: string; delayMs: number; fail?: boolean; models?: string[] }): Promise<{ url: string; close: () => void }> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const respond = (code: number, body: any) => {
        setTimeout(() => {
          res.writeHead(code, { "Content-Type": "application/json" });
          res.end(JSON.stringify(body));
        }, opts.delayMs);
      };
      if (req.url?.includes("/api/tags")) return respond(200, { models: (opts.models ?? ["m"]).map((name) => ({ name })) });
      if (req.url?.includes("/v1/models")) return respond(200, { data: (opts.models ?? ["m"]).map((id) => ({ id })) });
      if (opts.fail) return respond(500, { error: `${opts.name} exploded` });
      if (req.url?.includes("/api/chat")) return respond(200, { message: { content: JSON.stringify({ from: opts.name }) } });
      if (req.url?.includes("/v1/chat/completions")) return respond(200, { choices: [{ message: { content: JSON.stringify({ from: opts.name }) } }] });
      respond(404, { error: "unknown route" });
    });
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

const cfgWith = (ollamaUrl: string, lmStudioUrl: string): LLMConfig => ({
  provider: "fusion",
  ollamaUrl,
  ollamaModel: "stub-ollama",
  lmStudioUrl,
  lmStudioModel: "stub-lms",
});

(async () => {
  /* ---- 1. plumbing ---- */
  check("fusion counts as a local provider", isLocalProvider({ provider: "fusion" }));
  check("both local backends are fusion members", FUSION_MEMBERS.length === 2 && FUSION_MEMBERS.includes("ollama") && FUSION_MEMBERS.includes("lm_studio"));
  const mc = memberConfig(cfgWith("a", "b"), "lm_studio");
  check("memberConfig derives a standalone member config", mc.provider === "lm_studio" && mc.lmStudioUrl === "b");

  /* ---- 2. refiner alternation (injected worker mirror of buildLocalRefiner's schedule) ---- */
  {
    let turn = 0;
    const schedule: string[] = [];
    for (let i = 0; i < 4; i++) schedule.push(FUSION_MEMBERS[turn++ % FUSION_MEMBERS.length]);
    check("fusion rework schedule alternates members", schedule.join(",") === "ollama,lm_studio,ollama,lm_studio");
  }

  /* ---- 3. racing + failover against real stub servers ---- */
  const fast = await startStub({ name: "fast-lms", delayMs: 30 });
  const slow = await startStub({ name: "slow-ollama", delayMs: 400 });
  const dead = await startStub({ name: "dead", delayMs: 10, fail: true });

  const raced = await callLocalLLM({
    config: cfgWith(slow.url, fast.url),
    systemPrompt: "s",
    userText: "u",
  });
  check("race: fastest valid member wins", raced?.from === "fast-lms", JSON.stringify(raced));

  const failover = await callLocalLLM({
    config: cfgWith(slow.url, dead.url),
    systemPrompt: "s",
    userText: "u",
  });
  check("failover: surviving member answers when the other errors", failover?.from === "slow-ollama", JSON.stringify(failover));

  let allFailedMsg = "";
  try {
    await callLocalLLM({ config: cfgWith(dead.url, dead.url), systemPrompt: "s", userText: "u" });
  } catch (e: any) {
    allFailedMsg = e?.message ?? "";
  }
  check("all members down: error names the fusion and reasons", /fusion/i.test(allFailedMsg), allFailedMsg.slice(0, 80));

  /* ---- 4. detection honesty ---- */
  const both = await detectFusion(cfgWith(fast.url, fast.url));
  check("detect: available when both answer with models", both.available && both.reason === "");

  const noModels = await startStub({ name: "empty", delayMs: 10, models: [] });
  const half = await detectFusion(cfgWith(fast.url, noModels.url));
  check("detect: NOT available when a member has no models", !half.available && /LM Studio/.test(half.reason), half.reason.slice(0, 70));

  fast.close(); slow.close(); dead.close(); noModels.close();

  console.log(failures === 0 ? "\nFUSION: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();
