import { trustedLlmOrigins } from "./security";

export type ManagedProvider = "openai" | "anthropic" | "gemini" | "online_free";
export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };
export interface StructuredChatResult {
  result: Record<string, unknown>;
  model: string;
  attemptedModels?: string[];
}

const PROVIDER_MODELS: Record<ManagedProvider, readonly string[]> = {
  openai: ["gpt-5.6-terra", "gpt-5.6-luna", "gpt-5-nano"],
  anthropic: ["claude-sonnet-5", "claude-haiku-4-5", "claude-opus-5"],
  gemini: ["gemini-3.5-flash"],
  online_free: [],
};

export const MANAGED_PROVIDERS = Object.keys(PROVIDER_MODELS) as ManagedProvider[];

export function isManagedProvider(value: unknown): value is ManagedProvider {
  return typeof value === "string" && MANAGED_PROVIDERS.includes(value as ManagedProvider);
}

export function isAllowedModel(provider: ManagedProvider, model: unknown): model is string {
  if (provider === "online_free") return model === "auto" || typeof model === "string" && model.endsWith(":free") && model.length <= 200;
  return typeof model === "string" && PROVIDER_MODELS[provider].includes(model);
}

function integrationConfig(provider: "openai" | "anthropic") {
  const prefix = `AI_INTEGRATIONS_${provider.toUpperCase()}_`;
  const baseUrl = process.env[`${prefix}BASE_URL`];
  const apiKey = process.env[`${prefix}API_KEY`];
  if (!baseUrl || !apiKey) throw new Error(`${provider} integration is not configured on this server.`);
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" && process.env.NODE_ENV === "production") throw new Error(`${provider} integration must use HTTPS.`);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey };
}

async function readJsonResponse(response: Response): Promise<any> {
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { throw new Error("Provider returned a non-JSON response."); }
  if (!response.ok) throw new Error(data?.error?.message || data?.error || `Provider returned ${response.status}.`);
  return data;
}

async function managedFetchWithRetry(url: string, init: RequestInit, signal: AbortSignal): Promise<Response> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(url, { ...init, signal });
    if (!(response.status === 429 || response.status >= 500) || attempt === 1) return response;
    await response.body?.cancel();
    await sleep(250, signal);
  }
  throw new Error("Unreachable retry state.");
}

function parseStructured(content: unknown): Record<string, unknown> {
  if (typeof content !== "string") throw new Error("Provider returned no structured response.");
  try {
    const parsed = JSON.parse(content);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") throw new Error();
    return parsed;
  } catch {
    throw new Error("Provider returned invalid structured JSON.");
  }
}

export async function managedStructuredChat(
  provider: "openai" | "anthropic",
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const config = integrationConfig(provider);
  if (provider === "openai") {
    const response = await managedFetchWithRetry(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal,
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, max_completion_tokens: 8192 }),
    }, signal);
    const data = await readJsonResponse(response);
    return parseStructured(data?.choices?.[0]?.message?.content);
  }

  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n");
  const response = await managedFetchWithRetry(`${config.baseUrl}/v1/messages`, {
    method: "POST",
    signal,
    headers: {
      "x-api-key": config.apiKey,
      "anthropic-version": "2023-06-01",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model, max_tokens: 8192,
      ...(system ? { system: `${system}\nReturn exactly one JSON object and no markdown.` } : { system: "Return exactly one JSON object and no markdown." }),
      messages: messages.filter((m) => m.role !== "system").map(({ role, content }) => ({ role, content })),
    }),
  }, signal);
  const data = await readJsonResponse(response);
  return parseStructured(data?.content?.find((item: any) => item?.type === "text")?.text);
}

const OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const FREE_MODEL_FALLBACKS = [
  "meta-llama/llama-3.3-70b-instruct:free",
  "mistralai/mistral-small-3.1-24b-instruct:free",
  "google/gemma-3-27b-it:free",
  "qwen/qwen3-4b:free",
] as const;
const FREE_MODEL_CACHE_MS = 5 * 60_000;
let freeModelCache: { expiresAt: number; models: string[] } | undefined;
let freeModelTurn = 0;
const freeModelCooldowns = new Map<string, number>();

function openRouterKey(): string {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key?.trim()) throw new Error("Online Free provider is not configured on this server.");
  return key;
}

async function freeModels(signal: AbortSignal): Promise<string[]> {
  if (freeModelCache && freeModelCache.expiresAt > Date.now()) return freeModelCache.models;
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/models`, { headers: { Authorization: `Bearer ${openRouterKey()}` }, signal });
    const data = await readJsonResponse(response);
    const models = (Array.isArray(data?.data) ? data.data : []).map((entry: any) => entry?.id).filter((id: unknown): id is string => typeof id === "string" && id.endsWith(":free"));
    if (models.length) {
      freeModelCache = { models, expiresAt: Date.now() + FREE_MODEL_CACHE_MS };
      return models;
    }
  } catch {
    // Discovery is best effort: known-free fallbacks keep this provider useful
    // during model-list outages without ever selecting a paid model.
  }
  return [...FREE_MODEL_FALLBACKS];
}

function retryAfterMs(response: Response) {
  const seconds = Number(response.headers.get("retry-after"));
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 15 ? seconds * 1000 : 0;
}
function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { clearTimeout(timer); reject(Object.assign(new Error("Online Free request aborted."), { name: "AbortError" })); }, { once: true });
  });
}

export async function onlineFreeStructuredChat(messages: ChatMessage[], signal: AbortSignal): Promise<{ result: Record<string, unknown>; model: string; attemptedModels: string[] }> {
  const models = await freeModels(signal);
  const now = Date.now();
  const ordered = models
    .filter((model) => model.endsWith(":free") && (freeModelCooldowns.get(model) || 0) <= now)
    .sort((a, b) => ((models.indexOf(a) - freeModelTurn + models.length) % models.length) - ((models.indexOf(b) - freeModelTurn + models.length) % models.length))
    .slice(0, Math.min(3, models.length));
  const attemptedModels: string[] = [];
  for (const model of ordered) {
    attemptedModels.push(model);
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    try {
      const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST", signal: controller.signal,
        headers: { Authorization: `Bearer ${openRouterKey()}`, "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, response_format: { type: "json_object" }, max_tokens: 8192 }),
      });
      if (response.ok) {
        const data = await readJsonResponse(response);
        const result = parseStructured(data?.choices?.[0]?.message?.content);
        freeModelTurn = (models.indexOf(model) + 1) % models.length;
        return { result, model, attemptedModels };
      }
      const retryable = response.status === 402 || response.status === 429 || response.status >= 500;
      if (!retryable) await readJsonResponse(response); // provides the provider's non-retryable error
      freeModelCooldowns.set(model, Date.now() + Math.max(30_000, retryAfterMs(response)));
      if (retryAfterMs(response) && attemptedModels.length < ordered.length) await sleep(retryAfterMs(response), signal);
    } catch (error: any) {
      if (error?.name === "AbortError" || signal.aborted) throw error;
      freeModelCooldowns.set(model, Date.now() + 30_000);
    } finally {
      signal.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  const exhausted = Object.assign(new Error("All available free online models are temporarily unavailable."), { code: "ONLINE_FREE_EXHAUSTED" });
  throw exhausted;
}

/** One provider-neutral structured-output adapter shared by every server
 * generation route. Credentials remain server-managed and Online Free keeps
 * its strict free-only rotation and attempt reporting. */
export async function structuredProviderChat(
  provider: ManagedProvider,
  model: string,
  messages: ChatMessage[],
  signal: AbortSignal,
): Promise<StructuredChatResult> {
  if (provider === "online_free") return onlineFreeStructuredChat(messages, signal);
  if (provider === "gemini") {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey?.trim() || apiKey === "MY_GEMINI_API_KEY") throw new Error("GEMINI_API_KEY is not configured on this server.");
    const systemInstruction = messages.filter(message => message.role === "system").map(message => message.content).join("\n");
    const response = await managedFetchWithRetry(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: messages.filter(message => message.role !== "system").map(message => ({
          role: message.role === "assistant" ? "model" : "user",
          parts: [{ text: message.content }],
        })),
        ...(systemInstruction ? { system_instruction: { parts: [{ text: systemInstruction }] } } : {}),
        generationConfig: { responseMimeType: "application/json" },
      }),
    }, signal);
    const data = await readJsonResponse(response);
    const text = data?.candidates?.[0]?.content?.parts?.map((part: any) => part.text || "").join("");
    return { result: parseStructured(text), model };
  }
  return { result: await managedStructuredChat(provider, model, messages, signal), model };
}

/** Test-only deterministic state reset; no production route exposes this. */
export function resetOnlineFreeStateForTests() {
  freeModelCache = undefined;
  freeModelTurn = 0;
  freeModelCooldowns.clear();
}

export function managedHealth() {
  const remoteAllowed = process.env.NODE_ENV !== "production" || trustedLlmOrigins().length > 0;
  return Object.fromEntries(MANAGED_PROVIDERS.map((provider) => {
    if (provider === "gemini") return [provider, remoteAllowed && Boolean(process.env.GEMINI_API_KEY?.trim() && process.env.GEMINI_API_KEY !== "MY_GEMINI_API_KEY")];
    if (provider === "online_free") return [provider, remoteAllowed && Boolean(process.env.OPENROUTER_API_KEY?.trim())];
    const prefix = `AI_INTEGRATIONS_${provider.toUpperCase()}_`;
    return [provider, remoteAllowed && Boolean(process.env[`${prefix}BASE_URL`] && process.env[`${prefix}API_KEY`])];
  }));
}