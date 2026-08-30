import net from "node:net";
import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";

const BLOCKED_HEADERS = new Set(["authorization", "cookie", "host", "connection", "proxy-authorization", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]);
const SAFE_PROXY_METHODS = new Set(["GET", "POST"]);
export const MAX_PROXY_RESPONSE_BYTES = 2 * 1024 * 1024;

function isPrivateIpv4(host: string) {
  const parts = host.split(".").map(Number);
  return parts.length === 4 && parts.every((part) => Number.isInteger(part) && part >= 0 && part <= 255) &&
    (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) ||
     (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

export function isPrivateTarget(urlString: string): boolean {
  try {
    const url = new URL(urlString);
    const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
    if (host === "localhost" || host.endsWith(".localhost") || isPrivateIpv4(host)) return true;
    if (net.isIP(host) === 6) {
      const normalized = host.split("%")[0];
      if (normalized === "::1" || normalized === "::" || /^f[cd]/i.test(normalized) || /^fe[89ab]/i.test(normalized)) return true;
      const mapped = normalized.match(/^::ffff:(.+)$/i)?.[1];
      if (mapped) {
        if (isPrivateIpv4(mapped)) return true;
        const hex = mapped.split(":");
        if (hex.length === 2 && hex.every((part) => /^[0-9a-f]{1,4}$/i.test(part))) {
          const number = (parseInt(hex[0], 16) * 65536) + parseInt(hex[1], 16);
          return isPrivateIpv4([number >>> 24, (number >>> 16) & 255, (number >>> 8) & 255, number & 255].join("."));
        }
      }
      return false;
    }
    return false;
  } catch { return true; }
}

export interface PinnedProxyResponse { status: number; ok: boolean; text: string; }
/** Connect only to the DNS answer just validated, while retaining the URL's
 * hostname for TLS SNI and Host. This closes the lookup/fetch rebinding gap. */
export function pinnedProxyRequest(urlString: string, method: string, headers: Record<string, string>, body: string | undefined, address: string, signal: AbortSignal, maxBytes = MAX_PROXY_RESPONSE_BYTES): Promise<PinnedProxyResponse> {
  const url = new URL(urlString);
  const transport = url.protocol === "https:" ? https : http;
  return new Promise((resolve, reject) => {
    const request = transport.request({
      protocol: url.protocol, hostname: url.hostname, port: url.port || undefined, path: `${url.pathname}${url.search}`,
      method, headers, servername: url.hostname,
      lookup: (_host, optionsOrCallback: any, callbackMaybe?: any) => {
        const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : callbackMaybe;
        const family = address.includes(":") ? 6 : 4;
        if (optionsOrCallback?.all) callback(null, [{ address, family }]);
        else callback(null, address, family);
      },
    }, (response) => {
      const chunks: Buffer[] = []; let total = 0;
      const length = Number(response.headers["content-length"] || 0);
      if (length > maxBytes) { request.destroy(); return reject(new Error("Upstream response exceeds the proxy size limit.")); }
      response.on("data", (chunk: Buffer) => {
        total += chunk.length;
        if (total > maxBytes) request.destroy(new Error("Upstream response exceeds the proxy size limit."));
        else chunks.push(chunk);
      });
      response.on("end", () => resolve({ status: response.statusCode || 502, ok: (response.statusCode || 500) >= 200 && (response.statusCode || 500) < 300, text: Buffer.concat(chunks).toString("utf8") }));
    });
    request.once("error", reject);
    const abort = () => request.destroy(Object.assign(new Error("Proxy request aborted."), { name: "AbortError" }));
    signal.addEventListener("abort", abort, { once: true });
    request.once("close", () => signal.removeEventListener("abort", abort));
    if (body) request.write(body);
    request.end();
  });
}

/** DNS rebinding protection for production proxy requests. Every A/AAAA
 * answer must be public; accepting one public answer beside a private one is
 * still an SSRF vulnerability. `resolve` is injectable for deterministic tests. */
export async function assertPublicProxyTarget(
  targetUrl: string,
  resolve: (host: string, options: { all: true; verbatim: true }) => Promise<Array<{ address: string; family: number }>> = lookup,
): Promise<string[]> {
  const url = new URL(targetUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateTarget(targetUrl)) throw new Error("Private, loopback, and link-local proxy targets are not allowed in production.");
  const answers = await resolve(hostname, { all: true, verbatim: true });
  if (!answers.length || answers.some((answer) => isPrivateTarget(`http://${answer.family === 6 ? `[${answer.address}]` : answer.address}`))) {
    throw new Error("Proxy hostname resolves to a private, loopback, link-local, or unspecified address.");
  }
  return answers.map((answer) => answer.address);
}

export function validateProxyRequest(targetUrl: unknown, method: unknown, headers: unknown) {
  if (typeof targetUrl !== "string" || targetUrl.length > 2048) throw new Error("targetUrl must be a valid URL.");
  const url = new URL(targetUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Only HTTP(S) proxy targets are allowed.");
  if (url.username || url.password) throw new Error("Proxy target URLs must not contain credentials.");
  const normalizedMethod = typeof method === "string" ? method.toUpperCase() : "POST";
  if (!SAFE_PROXY_METHODS.has(normalizedMethod)) throw new Error("Only GET and POST proxy methods are allowed.");
  if (process.env.NODE_ENV === "production" && isPrivateTarget(targetUrl)) throw new Error("Private, loopback, and link-local proxy targets are not allowed in production.");
  const safeHeaders: Record<string, string> = {};
  if (headers !== undefined && (!headers || typeof headers !== "object" || Array.isArray(headers))) throw new Error("headers must be an object.");
  for (const [name, value] of Object.entries((headers || {}) as Record<string, unknown>)) {
    const lower = name.toLowerCase();
    if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(name) || BLOCKED_HEADERS.has(lower)) continue;
    if (typeof value === "string" && value.length <= 8192) safeHeaders[name] = value;
  }
  return { url: url.toString(), method: normalizedMethod, headers: safeHeaders };
}

export async function readResponseLimited(response: Response, maxBytes = MAX_PROXY_RESPONSE_BYTES): Promise<string> {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > maxBytes) throw new Error("Upstream response exceeds the proxy size limit.");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) { await reader.cancel(); throw new Error("Upstream response exceeds the proxy size limit."); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Temporary anonymous abuse boundary. Replace this with account/user-based
 * authorization and quotas when application authentication is available. */
export class LlmRequestGate {
  private clients = new Map<string, { requests: number[]; chars: Array<{ at: number; count: number }>; active: number }>();
  private globalActive = 0;
  constructor(private readonly opts = { windowMs: 60_000, maxRequests: 20, maxChars: 200_000, maxClientActive: 2, maxGlobalActive: 20 }) {}
  acquire(client: string, characters: number, now = Date.now()): { release: () => void } {
    const state = this.clients.get(client) || { requests: [], chars: [], active: 0 };
    state.requests = state.requests.filter((at) => at > now - this.opts.windowMs);
    state.chars = state.chars.filter((item) => item.at > now - this.opts.windowMs);
    const usedChars = state.chars.reduce((sum, item) => sum + item.count, 0);
    if (state.requests.length >= this.opts.maxRequests || usedChars + characters > this.opts.maxChars || state.active >= this.opts.maxClientActive || this.globalActive >= this.opts.maxGlobalActive) {
      const error: any = new Error("LLM request quota or concurrency limit exceeded.");
      error.status = 429; error.retryAfter = Math.max(1, Math.ceil(this.opts.windowMs / 1000)); throw error;
    }
    state.requests.push(now); state.chars.push({ at: now, count: characters }); state.active++; this.globalActive++; this.clients.set(client, state);
    let released = false;
    return { release: () => { if (!released) { released = true; state.active--; this.globalActive--; } } };
  }
}

export function trustedLlmOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const raw = [env.APP_PUBLIC_ORIGIN, env.LLM_ALLOWED_ORIGINS].filter(Boolean).join(",");
  const origins = new Set<string>();
  for (const item of raw.split(",").map((value) => value.trim()).filter(Boolean)) {
    try {
      const url = new URL(item);
      if ((url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash) origins.add(url.origin);
    } catch { /* Invalid allowlist entries never become trusted. */ }
  }
  return [...origins];
}

export function assertProductionSameOrigin(headers: Record<string, string | string[] | undefined>, env: NodeJS.ProcessEnv = process.env) {
  if (env.NODE_ENV !== "production") return;
  const origin = headers.origin;
  const allowed = trustedLlmOrigins(env);
  if (typeof origin !== "string" || !allowed.includes(origin)) {
    const error: any = new Error("Cross-origin LLM requests are not allowed."); error.status = 403; throw error;
  }
}