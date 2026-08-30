import {
  assertProductionSameOrigin, assertPublicProxyTarget, isPrivateTarget, LlmRequestGate, MAX_PROXY_RESPONSE_BYTES, pinnedProxyRequest, readResponseLimited, validateProxyRequest,
} from "../server/security";
import { isAllowedModel, managedStructuredChat, onlineFreeStructuredChat, resetOnlineFreeStateForTests } from "../server/llmProviders";
import http from "node:http";
import { AddressInfo } from "node:net";

let failures = 0;
const check = (label: string, ok: boolean) => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};

check("blocks IPv4 private targets", isPrivateTarget("http://172.20.0.1") && isPrivateTarget("http://127.0.0.1"));
check("blocks IPv6 loopback, unique-local, and link-local targets", isPrivateTarget("http://[::1]") && isPrivateTarget("http://[fd00::1]") && isPrivateTarget("http://[fe80::1]"));
check("blocks dotted and hexadecimal IPv4-mapped IPv6 private targets", isPrivateTarget("http://[::ffff:127.0.0.1]") && isPrivateTarget("http://[::ffff:7f00:1]") && isPrivateTarget("http://[::ffff:c0a8:101]"));
check("allows public HTTP target classification", !isPrivateTarget("https://example.com/path"));
check("limits managed provider models", isAllowedModel("openai", "gpt-5.6-terra") && !isAllowedModel("openai", "arbitrary-model"));
check("Online Free accepts automatic rotation selector", isAllowedModel("online_free", "auto") && isAllowedModel("online_free", "test/model:free") && !isAllowedModel("online_free", "test/model"));
const productionOrigins = { NODE_ENV: "production", APP_PUBLIC_ORIGIN: "https://app.example" } as NodeJS.ProcessEnv;
for (const [label, origin, accepted] of [
  ["missing Origin", undefined, false],
  ["forged Origin", "https://evil.example", false],
  ["allowlisted Origin", "https://app.example", true],
] as const) {
  let ok = true;
  try { assertProductionSameOrigin({ origin }, productionOrigins); } catch { ok = false; }
  check(`production LLM admission handles ${label}`, ok === accepted);
}

try {
  validateProxyRequest("file:///etc/passwd", "GET", {});
  check("rejects unsupported proxy scheme", false);
} catch { check("rejects unsupported proxy scheme", true); }
try {
  validateProxyRequest("https://user:pass@example.com", "GET", {});
  check("rejects credentialed proxy URL", false);
} catch { check("rejects credentialed proxy URL", true); }
const sanitized = validateProxyRequest("https://example.com", "POST", { Authorization: "secret", Cookie: "x", Accept: "application/json" });
check("drops sensitive forwarded headers", !("Authorization" in sanitized.headers) && !("Cookie" in sanitized.headers) && sanitized.headers.Accept === "application/json");

(async () => {
  const tooLarge = new Response("x".repeat(MAX_PROXY_RESPONSE_BYTES + 1));
  let rejected = false;
  try { await readResponseLimited(tooLarge); } catch { rejected = true; }
  check("caps streamed upstream responses", rejected);
  let dnsRejected = false;
  try {
    await assertPublicProxyTarget("https://model.example", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "fd00::9", family: 6 },
    ]);
  } catch { dnsRejected = true; }
  check("production DNS guard rejects hostnames with any private answer", dnsRejected);
  await assertPublicProxyTarget("https://model.example", async () => [{ address: "93.184.216.34", family: 4 }]);
  check("production DNS guard permits all-public deterministic answer", true);
  const gate = new LlmRequestGate({ windowMs: 1000, maxRequests: 1, maxChars: 10, maxClientActive: 1, maxGlobalActive: 1 });
  const lease = gate.acquire("client", 5, 0);
  let limited = false;
  try { gate.acquire("client", 5, 1); } catch (error: any) { limited = error.status === 429; }
  lease.release();
  check("LLM request gate enforces client sliding-window quotas", limited);

  let openaiRetriesRemaining = 0;
  let anthropicRetriesRemaining = 0;
  let openaiHits = 0;
  let anthropicHits = 0;
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      if (req.url === "/chat/completions") {
        openaiHits++;
        if (openaiRetriesRemaining-- > 0) return res.writeHead(429).end(JSON.stringify({ error: { message: "retry" } }));
        const auth = req.headers.authorization === "Bearer test-openai";
        const jsonMode = JSON.parse(body).response_format?.type === "json_object";
        res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ auth, jsonMode, provider: "openai" }) } }] }));
      } else if (req.url === "/v1/messages") {
        anthropicHits++;
        if (anthropicRetriesRemaining-- > 0) return res.writeHead(503).end(JSON.stringify({ error: { message: "retry" } }));
        const request = JSON.parse(body);
        const auth = req.headers["x-api-key"] === "test-anthropic";
        res.end(JSON.stringify({ content: [{ type: "text", text: JSON.stringify({ auth, structured: /exactly one JSON/.test(request.system), provider: "anthropic" }) }] }));
      } else res.writeHead(404).end();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.AI_INTEGRATIONS_OPENAI_BASE_URL = url;
  process.env.AI_INTEGRATIONS_OPENAI_API_KEY = "test-openai";
  process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL = url;
  process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY = "test-anthropic";
  const signal = new AbortController().signal;
  const openai = await managedStructuredChat("openai", "gpt-5.6-terra", [{ role: "user", content: "hi" }], signal);
  const anthropic = await managedStructuredChat("anthropic", "claude-sonnet-5", [{ role: "user", content: "hi" }], signal);
  check("OpenAI adapter sends managed credential and JSON mode", openai.auth === true && openai.jsonMode === true);
  check("Anthropic adapter sends managed credential and JSON instruction", anthropic.auth === true && anthropic.structured === true);
  openaiRetriesRemaining = 1;
  anthropicRetriesRemaining = 1;
  const beforeRetries = openaiHits + anthropicHits;
  await managedStructuredChat("openai", "gpt-5-nano", [{ role: "user", content: "retry once" }], signal);
  await managedStructuredChat("anthropic", "claude-haiku-4-5", [{ role: "user", content: "retry once" }], signal);
  check("managed adapters retry 429/5xx once without retrying successes", openaiHits + anthropicHits - beforeRetries === 4);

  const originalFetch = globalThis.fetch;
  const onlineCalls: string[] = [];
  let failEveryFreeModel = false;
  resetOnlineFreeStateForTests();
  process.env.OPENROUTER_API_KEY = "server-only-free-key";
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const target = String(input);
    if (target.endsWith("/models")) {
      return new Response(JSON.stringify({ data: [{ id: "test/a:free" }, { id: "test/b:free" }, { id: "paid/nope" }] }), { status: 200 });
    }
    const body = JSON.parse(String(init?.body));
    onlineCalls.push(body.model);
    if (failEveryFreeModel || body.model === "test/a:free") return new Response(JSON.stringify({ error: { message: "busy" } }), { status: 429, headers: { "retry-after": "0" } });
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"free":true}' } }] }), { status: 200 });
  }) as typeof fetch;
  const free = await onlineFreeStructuredChat([{ role: "user", content: "only JSON" }], new AbortController().signal);
  check("Online Free discovers only free IDs, retries and reports selected model", free.model === "test/b:free" && free.result.free === true && onlineCalls.join(",") === "test/a:free,test/b:free");
  failEveryFreeModel = true;
  let exhausted = false;
  try { await onlineFreeStructuredChat([{ role: "user", content: "only JSON" }], new AbortController().signal); } catch (error: any) { exhausted = error.code === "ONLINE_FREE_EXHAUSTED"; }
  check("Online Free returns typed exhaustion after bounded failed attempts", exhausted);
  globalThis.fetch = originalFetch;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const pinServer = http.createServer((_req, response) => response.end("pinned"));
  await new Promise<void>((resolve) => pinServer.listen(0, "127.0.0.1", resolve));
  const pinPort = (pinServer.address() as AddressInfo).port;
  const pinned = await pinnedProxyRequest(`http://rebind.invalid:${pinPort}/`, "GET", {}, undefined, "127.0.0.1", new AbortController().signal);
  check("pinned proxy connection ignores a rebinding hostname lookup", pinned.ok && pinned.text === "pinned");
  await new Promise<void>((resolve) => pinServer.close(() => resolve()));
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nSERVER SECURITY: ALL CHECKS PASS");
  process.exit(failures ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });