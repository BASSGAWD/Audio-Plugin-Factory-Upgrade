import { DEFAULT_LLM_CONFIG, callLLM, getLLMConfig, selectedModel } from "../src/utils/llmGateway";

let failures = 0;
function check(label: string, value: boolean) {
  if (!value) failures++;
  console.log(`${value ? "PASS" : "FAIL"} ${label}`);
}

(async () => {
  const storage = new Map<string, string>();
  (globalThis as any).localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };

  storage.set("orange_juce_llm_config", JSON.stringify({ provider: "openai", ollamaModel: "old-local" }));
  const migrated = getLLMConfig();
  check("old configs gain OpenAI model default", migrated.openaiModel === DEFAULT_LLM_CONFIG.openaiModel);
  check("old configs gain Anthropic model default", migrated.anthropicModel === DEFAULT_LLM_CONFIG.anthropicModel);

  const originalFetch = globalThis.fetch;
  let captured: any;
  globalThis.fetch = (async (url: string, options: RequestInit) => {
    captured = { url, body: JSON.parse(String(options.body)) };
    return new Response(JSON.stringify({ provider: "openai", model: "gpt-5-nano", result: { text: "ok" } }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  const payload = await callLLM({
    config: { ...DEFAULT_LLM_CONFIG, provider: "openai", openaiModel: "gpt-5-nano" },
    systemPrompt: "system",
    userText: "hello",
    history: [{ role: "user", text: "earlier" }],
    temperature: 0.2,
  });
  check("remote calls use the provider-neutral endpoint", captured?.url === "/api/llm/chat");
  check("remote calls send explicit provider and model", captured?.body?.provider === "openai" && captured?.body?.model === "gpt-5-nano");
  check("remote calls normalize the server result envelope", payload?.text === "ok");
  check("selectedModel falls back safely for migrated remote config", selectedModel({ ...migrated, provider: "anthropic", anthropicModel: undefined }) === DEFAULT_LLM_CONFIG.anthropicModel);

  captured = undefined;
  await callLLM({
    config: { ...DEFAULT_LLM_CONFIG, provider: "online_free", onlineFreeActiveModel: "previous-free-model" },
    systemPrompt: "system",
    userText: "free request",
  });
  check("Online Free always asks the server for auto selection", captured?.body?.provider === "online_free" && captured?.body?.model === "auto");

  globalThis.fetch = (async () => new Response(JSON.stringify({ code: "ONLINE_FREE_EXHAUSTED", error: "free pool exhausted" }), { status: 503, headers: { "Content-Type": "application/json" } })) as typeof fetch;
  let exhausted: any;
  try {
    await callLLM({ config: { ...DEFAULT_LLM_CONFIG, provider: "online_free" }, systemPrompt: "s", userText: "u" });
  } catch (error) {
    exhausted = error;
  }
  check("Online Free exhaustion keeps typed code and 503 status", exhausted?.code === "ONLINE_FREE_EXHAUSTED" && exhausted?.status === 503);
  globalThis.fetch = originalFetch;

  console.log(failures === 0 ? "\nPROVIDER GATEWAY: ALL CHECKS PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
})();