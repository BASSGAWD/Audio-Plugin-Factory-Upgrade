/**
 * Shared local-LLM gateway: config storage, connection testing/model discovery,
 * and a generic JSON-mode chat call for Ollama / LM Studio.
 *
 * Consolidates logic that used to be duplicated between App.tsx and MemoryCore.tsx.
 * Defaults to a local provider so the app works offline out of the box.
 */

export type LLMProvider = "gemini" | "ollama" | "lm_studio" | "fusion";

/** The local backends a fusion can combine. */
export type FusionMember = "ollama" | "lm_studio";
export const FUSION_MEMBERS: FusionMember[] = ["ollama", "lm_studio"];

/** A member's standalone config: the same URLs/models, acting as one provider. */
export function memberConfig(cfg: LLMConfig, member: FusionMember): LLMConfig {
  return { ...cfg, provider: member };
}

export interface LLMConfig {
  provider: LLMProvider;
  ollamaUrl: string;
  ollamaModel: string;
  lmStudioUrl: string;
  lmStudioModel: string;
  lowVramMode?: boolean;
  maxContextMessages?: number;
  systemPromptStyle?: "standard" | "compact";
}

export const STORAGE_KEY_LLM_CONFIG = "orange_juce_llm_config";

// Use 127.0.0.1, not "localhost" -- Node's fetch (undici), used by the server-side
// /api/proxy relay, can try IPv6 (::1) first when resolving "localhost" on Windows
// and fail with a generic "fetch failed" if the local server only listens on IPv4.
// 127.0.0.1 sidesteps DNS resolution entirely and works from both the browser and Node.
export const DEFAULT_LLM_CONFIG: LLMConfig = {
  provider: "ollama",
  ollamaUrl: "http://127.0.0.1:11434",
  ollamaModel: "qwen2.5-coder:14b",
  lmStudioUrl: "http://127.0.0.1:1234",
  lmStudioModel: "qwen/qwen3-14b",
  lowVramMode: false,
  maxContextMessages: 4,
  systemPromptStyle: "standard",
};

function normalizeLocalhost(cfg: LLMConfig): LLMConfig {
  return {
    ...cfg,
    ollamaUrl: cfg.ollamaUrl.replace("://localhost", "://127.0.0.1"),
    lmStudioUrl: cfg.lmStudioUrl.replace("://localhost", "://127.0.0.1"),
  };
}

export function getLLMConfig(): LLMConfig {
  const raw = localStorage.getItem(STORAGE_KEY_LLM_CONFIG);
  if (!raw) return { ...DEFAULT_LLM_CONFIG };
  try {
    return normalizeLocalhost({ ...DEFAULT_LLM_CONFIG, ...JSON.parse(raw) });
  } catch (e) {
    return { ...DEFAULT_LLM_CONFIG };
  }
}

export function saveLLMConfig(cfg: LLMConfig): void {
  localStorage.setItem(STORAGE_KEY_LLM_CONFIG, JSON.stringify(cfg));
}

export function isLocalProvider(cfg: Pick<LLMConfig, "provider">): boolean {
  return cfg.provider === "ollama" || cfg.provider === "lm_studio" || cfg.provider === "fusion";
}

/**
 * Fetch helper that hits localhost directly, or routes through the server's
 * /api/proxy relay for non-local targets (tunnels, remote hosts) to dodge
 * browser mixed-content/CORS limits.
 */
async function fetchViaServerProxy(
  targetUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal },
  defaultHeaders: Record<string, string>
): Promise<Response> {
  const relayResponse = await fetch("/api/proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    signal: options.signal,
    body: JSON.stringify({
      targetUrl,
      method: options.method || "GET",
      headers: defaultHeaders,
      body: options.body,
    }),
  });

  if (!relayResponse.ok) {
    const errorJson = await relayResponse.json().catch(() => ({}));
    throw new Error(
      errorJson.error ||
        (relayResponse.status === 404
          ? "This app's backend isn't serving /api/proxy — run the app via `npm run dev` (or `npm start`), not a static file server."
          : `Server proxy failed with code ${relayResponse.status}`)
    );
  }

  const relayData = await relayResponse.json();
  if (!relayData.ok) {
    // Surface the UPSTREAM error body (e.g. Ollama's "model 'x' not found",
    // LM Studio's "No models loaded") -- that's the actionable message.
    const upstream = relayData.jsonPayload?.error;
    const upstreamMsg = typeof upstream === "string" ? upstream : upstream?.message;
    throw new Error(upstreamMsg || relayData.responseText || `Remote server returned error code ${relayData.status}`);
  }

  return {
    ok: true,
    status: relayData.status,
    json: async () => relayData.jsonPayload || JSON.parse(relayData.responseText || "{}"),
    text: async () => relayData.responseText || "",
  } as Response;
}

export async function fetchLLMRoute(
  targetUrl: string,
  options: { method?: string; headers?: Record<string, string>; body?: any; signal?: AbortSignal } = {}
): Promise<Response> {
  const isLocal = targetUrl.includes("localhost") || targetUrl.includes("127.0.0.1");

  const defaultHeaders = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "bypass-tunnel-reminder": "true",
    "ngrok-skip-browser-warning": "true",
    ...options.headers,
  };

  if (isLocal) {
    // Ollama/LM Studio run on a different port than this app (e.g. 11434 vs 3000),
    // so a direct browser fetch is cross-origin and gets silently blocked by CORS
    // unless the local server happens to allow this exact origin. Try direct first
    // (works when the target allows it, and needs no server hop), and fall back to
    // routing through this app's own /api/proxy relay -- which runs in Node and
    // isn't subject to browser CORS -- on any failure.
    try {
      return await fetch(targetUrl, {
        method: options.method || "GET",
        headers: defaultHeaders,
        signal: options.signal,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (err) {
      return await fetchViaServerProxy(targetUrl, options, defaultHeaders);
    }
  }

  return await fetchViaServerProxy(targetUrl, options, defaultHeaders);
}

export interface ConnectionTestResult {
  ok: boolean;
  models: string[];
  message: string;
}

export async function testProviderConnection(
  provider: "ollama" | "lm_studio",
  cfg: LLMConfig
): Promise<ConnectionTestResult> {
  const url = provider === "ollama" ? cfg.ollamaUrl : cfg.lmStudioUrl;
  const path = provider === "ollama" ? "/api/tags" : "/v1/models";

  try {
    const res = await fetchLLMRoute(`${url}${path}`, { method: "GET" });
    if (!res.ok) throw new Error(`Server returned status ${res.status}`);
    const data = await res.json();
    const models: string[] =
      provider === "ollama"
        ? (data.models || []).map((m: any) => m.name)
        : (data.data || []).map((m: any) => m.id);

    return {
      ok: true,
      models,
      message: models.length > 0 ? `Connected. ${models.length} model(s) available.` : "Connected, but no models are loaded.",
    };
  } catch (err: any) {
    return { ok: false, models: [], message: err.message || "Connection failed." };
  }
}

export interface FusionAvailability {
  /** True when EVERY member is reachable with at least one model loaded. */
  available: boolean;
  members: Array<{ provider: FusionMember; ok: boolean; models: string[]; message: string }>;
  /** Human-readable reason when not available. */
  reason: string;
}

/**
 * Probe every fusion member in parallel and report whether a fusion is
 * actually possible right now. Honest by construction: a fusion is only
 * offered when BOTH backends answer with a loaded model — never on hope.
 */
export async function detectFusion(cfg: LLMConfig): Promise<FusionAvailability> {
  const results = await Promise.all(
    FUSION_MEMBERS.map(async (provider) => {
      const r = await testProviderConnection(provider, cfg);
      return { provider, ok: r.ok && r.models.length > 0, models: r.models, message: r.message };
    })
  );
  const missing = results.filter((r) => !r.ok);
  return {
    available: missing.length === 0,
    members: results,
    reason:
      missing.length === 0
        ? ""
        : missing
            .map((m) => `${m.provider === "ollama" ? "Ollama" : "LM Studio"}: ${m.message}`)
            .join(" · "),
  };
}

/**
 * Probe Ollama then LM Studio and return an updated config pointed at
 * whichever one responds, preferring an already-loaded model if present.
 * Leaves the config untouched if neither is reachable.
 */
export async function autoDetectProvider(cfg: LLMConfig): Promise<LLMConfig> {
  const ollama = await testProviderConnection("ollama", cfg);
  if (ollama.ok) {
    const model = ollama.models.includes(cfg.ollamaModel) ? cfg.ollamaModel : ollama.models[0] || cfg.ollamaModel;
    return { ...cfg, provider: "ollama", ollamaModel: model };
  }

  const lmStudio = await testProviderConnection("lm_studio", cfg);
  if (lmStudio.ok) {
    const model = lmStudio.models.includes(cfg.lmStudioModel) ? cfg.lmStudioModel : lmStudio.models[0] || cfg.lmStudioModel;
    return { ...cfg, provider: "lm_studio", lmStudioModel: model };
  }

  return cfg;
}

/**
 * Tolerant JSON extraction for model responses. Even in JSON mode, local
 * models occasionally wrap the object in markdown fences or prepend chatter;
 * each such near-miss used to throw and burn the whole generation. Salvage
 * the outermost {...} instead.
 */
/** Scan for the first COMPLETE balanced JSON object, respecting strings and
 *  escapes — survives leading chatter AND trailing text/objects, which the
 *  naive first-{...last-} slice does not. */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseModelJson(raw: string): any {
  const text = (raw || "").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const unfenced = text.replace(/^[\s\S]*?```(?:json)?\s*\n?/i, "").replace(/\n?```[\s\S]*$/, "").trim() || text;
    try {
      return JSON.parse(unfenced);
    } catch {
      const balanced = extractFirstJsonObject(unfenced) ?? extractFirstJsonObject(text);
      if (balanced) {
        try {
          return JSON.parse(balanced);
        } catch {
          // Local models often emit RAW control characters (real newlines,
          // tabs) inside JSON string values — escape them and retry.
          try {
            let out = "";
            let inString = false;
            let escaped = false;
            for (const ch of balanced) {
              if (inString) {
                if (escaped) { escaped = false; out += ch; continue; }
                if (ch === "\\") { escaped = true; out += ch; continue; }
                if (ch === '"') { inString = false; out += ch; continue; }
                if (ch === "\n") { out += "\\n"; continue; }
                if (ch === "\r") { out += "\\r"; continue; }
                if (ch === "\t") { out += "\\t"; continue; }
                out += ch;
                continue;
              }
              if (ch === '"') inString = true;
              out += ch;
            }
            return JSON.parse(out);
          } catch {
            // fall through to the legacy widest-slice attempt
          }
        }
      }
      const start = unfenced.indexOf("{");
      const end = unfenced.lastIndexOf("}");
      if (start >= 0 && end > start) {
        return JSON.parse(unfenced.slice(start, end + 1)); // let this one throw -- it's genuinely malformed
      }
      throw new Error("Model response contained no parsable JSON object.");
    }
  }
}

export interface LocalChatMessage {
  role: "user" | "model";
  text: string;
}

export interface LocalLLMCallParams {
  config: LLMConfig;
  systemPrompt: string;
  userText: string;
  history?: LocalChatMessage[];
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Generic JSON-mode chat completion against whichever local provider is
 * configured. Throws if the provider isn't local or the request fails;
 * callers are expected to fall back (offline heuristics, cached templates).
 */
export async function callLocalLLM(params: LocalLLMCallParams): Promise<any> {
  const { config, systemPrompt, userText, history = [], temperature = 0.6, signal } = params;

  // FUSION: fan the same request out to every member in parallel and take the
  // first valid response. Two real wins over a single backend: latency (the
  // faster model answers) and resilience (one backend down/unloaded doesn't
  // fail the call). Quality-contest fusion (both answers judged) happens at
  // the orchestration layer where a verifier exists — see the refinement
  // loop's alternating fusion refiner.
  if (config.provider === "fusion") {
    try {
      return await Promise.any(
        FUSION_MEMBERS.map((m) => callLocalLLM({ ...params, config: memberConfig(config, m) }))
      );
    } catch (err: any) {
      const reasons = (err?.errors ?? []).map((e: any) => e?.message).filter(Boolean).join(" | ");
      throw new Error(`Fusion: no member responded (${reasons || "all backends failed"})`);
    }
  }
  const maxContext = config.maxContextMessages ?? 4;

  const messages: Array<{ role: string; content: string }> = [{ role: "system", content: systemPrompt }];
  history.slice(-maxContext).forEach((msg) => {
    messages.push({ role: msg.role === "user" ? "user" : "assistant", content: msg.text });
  });
  messages.push({ role: "user", content: userText });

  if (config.provider === "ollama") {
    const res = await fetchLLMRoute(`${config.ollamaUrl}/api/chat`, {
      method: "POST",
      signal,
      body: {
        model: config.ollamaModel,
        messages,
        stream: false,
        format: "json",
        options: { temperature },
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
      throw new Error(detail ? `Ollama: ${detail}` : `Ollama gateway returned status ${res.status}`);
    }
    const data = await res.json();
    return parseModelJson(data.message?.content || "{}");
  }

  if (config.provider === "lm_studio") {
    const request = (withJsonFormat: boolean) =>
      fetchLLMRoute(`${config.lmStudioUrl}/v1/chat/completions`, {
        method: "POST",
        signal,
        body: {
          model: config.lmStudioModel,
          messages,
          temperature,
          // Newer LM Studio builds reject OpenAI's "json_object" (they want
          // "json_schema" or "text"); on a 400 we retry with NO format field
          // and let parseModelJson salvage the JSON from plain text.
          ...(withJsonFormat ? { response_format: { type: "json_object" } } : {}),
        },
      });

    let res: Response;
    try {
      res = await request(true);
      if (!res.ok && res.status === 400) throw new Error("response_format rejected (400)");
    } catch (err: any) {
      if (err?.name === "AbortError" || !/400|response_format/i.test(err?.message || "")) throw err;
      res = await request(false);
    }
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      const detail = typeof body?.error === "string" ? body.error : body?.error?.message;
      throw new Error(detail ? `LM Studio: ${detail}` : `LM Studio gateway returned status ${res.status}`);
    }
    const data = await res.json();
    return parseModelJson(data.choices?.[0]?.message?.content || "{}");
  }

  throw new Error(`callLocalLLM: provider "${config.provider}" is not a local provider.`);
}
