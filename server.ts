import express from "express";
import path from "path";
import dotenv from "dotenv";
import { GoogleGenAI, Type } from "@google/genai";
import { createServer as createViteServer } from "vite";
import { scaffoldNativeProject, startNativeBuildForScaffold, getBuildJob, getCompletedBuildArtifact } from "./server/nativeBuild";
import { ChatMessage, isAllowedModel, isManagedProvider, managedHealth, structuredProviderChat } from "./server/llmProviders";
import { audioProjectProviderMessages, finalizeAudioProjectGeneration, validateAudioProjectGenerationBody } from "./server/audioProjectGeneration";
import { audioProjectToNativePlugin } from "./server/audioProjectNative";
import { assertProductionSameOrigin, assertPublicProxyTarget, LlmRequestGate, pinnedProxyRequest, readResponseLimited, validateProxyRequest } from "./server/security";
import { DSP_CODING_RULES, PARAMETER_DESIGN_RULES, AMP_CAB_SCHEMA_GUIDANCE, SAMPLER_SCHEMA_GUIDANCE, SOUND_QUALITY_RULES, RESPONSE_STYLE_RULES } from "./src/utils/dspPromptKit";
import { compileAudioSoftwareProject } from "./src/audioProjects";

// Load environment variables
dotenv.config();
import dawSyncRouter from "./server/dawSync";

const app = express();
// Honor an assigned PORT (preview harness / hosting) and fall back to 3000.
// The frontend calls the API on the same origin (relative paths), so any port
// works -- nothing is hardcoded to 3000 on the client side.
const PORT = Number(process.env.PORT) || 3000;

// Set up JSON body parser with high limits for code content
app.use(express.json({ limit: "20mb" }));
// dawSyncRouter's own requireUser middleware reads the X-Sync-Code header
// (src/daw/pairing.ts's device-pairing code) -- no app-level auth middleware
// needed; this replaced Clerk's clerkMiddleware(), which used to run here.
app.use("/api/daw-sync", express.raw({ type: ["audio/*", "application/octet-stream"], limit: "1gb" }), dawSyncRouter);

const LLM_MAX_MESSAGES = 24;
const LLM_MAX_MESSAGE_CHARS = 16_000;
const LLM_MAX_TOTAL_CHARS = 80_000;
const LLM_DEADLINE_MS = 45_000;
const llmRequestGate = new LlmRequestGate();

function validateLlmChatBody(body: any): { provider: "openai" | "anthropic" | "gemini" | "online_free"; model: string; messages: ChatMessage[] } {
  if (!body || !isManagedProvider(body.provider) || !isAllowedModel(body.provider, body.model)) throw new Error("Unsupported managed provider or model.");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > LLM_MAX_MESSAGES) throw new Error(`messages must contain 1-${LLM_MAX_MESSAGES} entries.`);
  let total = 0;
  const messages = body.messages.map((message: any) => {
    if (!message || !["system", "user", "assistant"].includes(message.role) || typeof message.content !== "string" || !message.content.trim() || message.content.length > LLM_MAX_MESSAGE_CHARS) {
      throw new Error("Each message needs a supported role and non-empty content within the size limit.");
    }
    total += message.content.length;
    return { role: message.role, content: message.content } as ChatMessage;
  });
  if (total > LLM_MAX_TOTAL_CHARS) throw new Error("Combined message content exceeds the size limit.");
  return { provider: body.provider, model: body.model, messages };
}

function requestAbortSignal(req: express.Request, res: express.Response) {
  const controller = new AbortController();
  const abortError = (message: string) => Object.assign(new Error(message), { name: "AbortError" });
  const timer = setTimeout(() => controller.abort(abortError("LLM request deadline exceeded.")), LLM_DEADLINE_MS);
  const abort = () => controller.abort(abortError("Client disconnected."));
  req.once("aborted", abort);
  res.once("close", abort);
  return { signal: controller.signal, cleanup: () => { clearTimeout(timer); req.off("aborted", abort); res.off("close", abort); } };
}

function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(Object.assign(new Error("LLM request aborted."), { name: "AbortError" }));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(Object.assign(new Error("LLM request deadline exceeded or client disconnected."), { name: "AbortError" }));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

// Optional visual-styling fields shared by both Gemini parameter schemas.
// Without these in the responseSchema, Gemini's structured output silently
// strips the amp/cab component fields the UI knows how to render.
const PARAMETER_VISUAL_SCHEMA_PROPS = {
  controlType: { type: Type.STRING, description: "Widget type: knob (default) | slider | toggle | amp (full amp head faceplate) | cab (speaker cabinet). Use amp+cab for guitar/bass amp sims." },
  customText: { type: Type.STRING, description: "Brand-style text shown on amp/cab faceplates, e.g. 'PLEXI 50W'" },
  bgColor: { type: Type.STRING, description: "Hex background color for amp/cab components" },
  borderColor: { type: Type.STRING, description: "Hex border color for amp/cab components" },
  accentColor: { type: Type.STRING, description: "Hex accent/glow color" },
  fontStyle: { type: Type.STRING, description: "One of: sans | mono | serif | grotesk | orbitron" },
  ampTolexPattern: { type: Type.STRING, description: "Amp covering: leather | carbon | tweed | wood | snakeskin | metalgrid" },
  ampKnobStyle: { type: Type.STRING, description: "Amp knobs: chickenhead | silvercap | pointer | neonring | vintage" },
  ampChannelType: { type: Type.STRING, description: "Amp voicing: clean | crunch | lead | modern" },
  ampTubeGlow: { type: Type.BOOLEAN, description: "Show glowing vacuum tubes on the amp" },
  cabGrillStyle: { type: Type.STRING, description: "Cab grill: weave | metalgrid | stripes | pinstripe | retro" },
  cabSize: { type: Type.STRING, description: "Cab size: 1x12 | 2x12 | 4x12 | 8x10" },
  cabMicModel: { type: Type.STRING, description: "Mic: SM57 | R-121 | MD421 | C414" },
} as const;

// Helper to transform common Gemini/API errors into human-friendly diagnostics
function handleApiError(error: any, res: express.Response, fallbackMessage: string) {
  const errorStr = typeof error === "string" ? error : JSON.stringify(error) + " " + (error.stack || "") + " " + (error.message || "");
  console.error(`[API Error Log] ${fallbackMessage}:`, error);

  if (
    errorStr.includes("API_KEY_INVALID") ||
    errorStr.includes("API key not valid") ||
    (errorStr.includes("INVALID_ARGUMENT") && errorStr.includes("API key"))
  ) {
    return res.status(401).json({
      error: "Your Gemini API key is invalid or set to a placeholder. Please configure a valid Gemini API key via the Secrets/Settings panel in the AI Studio interface. If you are running locally, check that the GEMINI_API_KEY environment variable is correctly set in your .env file."
    });
  }

  res.status(500).json({ error: error.message || fallbackMessage });
}

// Lazy initializer for GoogleGenAI to ensure it doesn't crash on boot if key is missing
let aiClient: GoogleGenAI | null = null;
function getGenAI(): GoogleGenAI {
  if (!aiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "MY_GEMINI_API_KEY" || apiKey.trim() === "") {
      throw new Error("GEMINI_API_KEY environment variable is missing or set to the placeholder 'MY_GEMINI_API_KEY'. Please provide a valid Gemini API key via the Secrets/Settings panel in the AI Studio UI.");
    }
    aiClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiClient;
}

// 1. Health Status check
app.get("/api/health", (req, res) => {
  const apiKey = process.env.GEMINI_API_KEY;
  const hasValidKey = !!apiKey && apiKey !== "MY_GEMINI_API_KEY" && apiKey.trim() !== "";
  res.json({
    status: "ok",
    hasApiKey: hasValidKey,
    timestamp: new Date().toISOString(),
  });
});

/** Server-managed providers deliberately use integration credentials only. */
app.get("/api/llm/health", (_req, res) => {
  res.json({ status: "ok", providers: managedHealth() });
});

app.post("/api/llm/chat", async (req, res) => {
  let cleanup: (() => void) | undefined;
  let release: (() => void) | undefined;
  try {
    const { provider, model, messages } = validateLlmChatBody(req.body);
    assertProductionSameOrigin(req.headers);
    release = llmRequestGate.acquire(req.socket.remoteAddress || "unknown", messages.reduce((sum, message) => sum + message.content.length, 0)).release;
    const abort = requestAbortSignal(req, res);
    cleanup = abort.cleanup;
    const generated = await structuredProviderChat(provider, model, messages, abort.signal);
    if (!res.headersSent && !abort.signal.aborted) {
      res.json({
        provider,
        model: generated.model,
        ...(generated.attemptedModels ? { attemptedModels: generated.attemptedModels } : {}),
        result: generated.result,
      });
    }
  } catch (error: any) {
    if (!res.headersSent) {
      if (error?.status === 429 && error?.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      res.status(error?.code === "ONLINE_FREE_EXHAUSTED" ? 503 : error?.name === "AbortError" ? 504 : error?.status || 400).json({ ...(error?.code ? { code: error.code } : {}), error: error?.message || "Managed LLM request failed." });
    }
  } finally { cleanup?.(); release?.(); }
});

/** General audio-software compiler. The plugin route below remains compatible,
 * while new callers receive one versioned project contract for every supported
 * audio-software category. */
app.post("/api/audio-projects/generate", async (req, res) => {
  let cleanup: (() => void) | undefined;
  let release: (() => void) | undefined;
  try {
    const request = validateAudioProjectGenerationBody(req.body);
    const compilation = compileAudioSoftwareProject(request.prompt, request.legacyPlugin);
    if (!request.provider || !request.model) return res.json(finalizeAudioProjectGeneration(compilation));

    assertProductionSameOrigin(req.headers);
    release = llmRequestGate.acquire(req.socket.remoteAddress || "unknown", request.prompt.length).release;
    const abort = requestAbortSignal(req, res);
    cleanup = abort.cleanup;
    try {
      const generated = await structuredProviderChat(request.provider, request.model, audioProjectProviderMessages(request.prompt, compilation), abort.signal);
      if (!res.headersSent && !abort.signal.aborted) {
        res.json({
          provider: request.provider,
          model: generated.model,
          ...(generated.attemptedModels ? { attemptedModels: generated.attemptedModels } : {}),
          ...finalizeAudioProjectGeneration(compilation, generated.result),
        });
      }
    } catch (error: any) {
      if (error?.name === "AbortError" || abort.signal.aborted) throw error;
      if (!res.headersSent) {
        res.json({
          provider: request.provider,
          model: request.model,
          ...finalizeAudioProjectGeneration(compilation, undefined, error?.message || "Provider refinement failed."),
        });
      }
    }
  } catch (error: any) {
    if (!res.headersSent) {
      if (error?.status === 429 && error?.retryAfter) res.setHeader("Retry-After", String(error.retryAfter));
      res.status(error?.name === "AbortError" ? 504 : error?.status || 400).json({ error: error?.message || "Audio software project generation failed." });
    }
  } finally {
    cleanup?.();
    release?.();
  }
});

// 2. Main Plugin Generator: Creates structured JS DSP prototype + Faust + C++ JUCE + Sliders metadata
app.post("/api/plugins/generate", async (req, res) => {
  try {
    const { prompt } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "DSP specification prompt is required." });
    }

    const ai = getGenAI();

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Generate a fully functional audio plugin specification and code assets based on: "${prompt}". Your response must follow the strict JSON schema matching filters, waveshapers, delays, synthesizers, etc.`,
      config: {
        systemInstruction: `You are an elite DSP Audio Engineer. You write bulletproof math and code.
${DSP_CODING_RULES}
${SOUND_QUALITY_RULES}
${PARAMETER_DESIGN_RULES}
${AMP_CAB_SCHEMA_GUIDANCE}
${SAMPLER_SCHEMA_GUIDANCE}
Also, provide highly structured "faustCode" and "cppJuceCode" so developers can download and compile them directly.`,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            pluginName: { type: Type.STRING, description: "Compact, creative name for the audio plugin" },
            category: {
              type: Type.STRING,
              description: "Must be exactly one of: distortion, delay, filter, synthesizer, dynamics, modulation, reverb"
            },
            description: { type: Type.STRING, description: "Creative 2-sentence marketing pitch explaining what the plugin does" },
            parameters: {
              type: Type.ARRAY,
              description: "Interactive slider definitions that control the DSP live",
              items: {
                type: Type.OBJECT,
                properties: {
                  id: { type: Type.STRING, description: "Unique parameter ID, matches what will be evaluated in the params object, e.g. 'cutoff'" },
                  name: { type: Type.STRING, description: "Display label for users, e.g. 'Cutoff Freq'" },
                  min: { type: Type.NUMBER, description: "Minimum numerical value" },
                  max: { type: Type.NUMBER, description: "Maximum numerical value" },
                  defaultValue: { type: Type.NUMBER, description: "Default starting value" },
                  unit: { type: Type.STRING, description: "Suffix, e.g. 'Hz', 'dB', '%', 'ms'" },
                  ...PARAMETER_VISUAL_SCHEMA_PROPS
                },
                required: ["id", "name", "min", "max", "defaultValue", "unit"]
              }
            },
            dspFunction: {
              type: Type.STRING,
              description: "Perfect javascript function body mapping inputSample to outputSample using state and params. E.g. 'if(!state.v) state.v = 0; state.v = state.v*0.9 + inputSample*0.1; return state.v;'"
            },
            faustCode: { type: Type.STRING, description: "A beautifully structured Faust DSP implementation of this effect" },
            cppJuceCode: { type: Type.STRING, description: "A highly robust, production-ready C++ core class or processBlock snippet for the JUCE library" }
          },
          required: ["pluginName", "category", "description", "parameters", "dspFunction", "faustCode", "cppJuceCode"]
        },
        temperature: 0.3,
      }
    });

    const textResult = response.text;
    if (!textResult) {
      throw new Error("No payload returned from standard model generation.");
    }

    res.json(JSON.parse(textResult));
  } catch (error: any) {
    handleApiError(error, res, "Failed to generate audio plugin assets.");
  }
});

// 3. Chat with specialised DSP Agent Roles with code context
app.post("/api/plugins/chat", async (req, res) => {
  try {
    const { prompt, history, systemInstruction, temperature, activeCode, activeParams, discoveryContext } = req.body;

    if (!prompt) {
      return res.status(400).json({ error: "Prompt is required." });
    }

    const ai = getGenAI();

    // Reconstruct conversation history structure
    const contents: any[] = [];
    if (history && Array.isArray(history)) {
      // Clean up history records for standard Gemini chat structure
      // To prevent JSON parsing errors in historical text, preserve original strings.
      history.slice(-10).forEach((msg: any) => {
        // If msg contains structured JSON from previous turns, only extraction is needed.
        let msgText = msg.text;
        try {
          // If history text was saved as a JSON string, try to parse the 'text' property
          if (msgText.trim().startsWith("{")) {
            const parsed = JSON.parse(msgText);
            if (parsed.text) msgText = parsed.text;
          }
        } catch (e) {
          // Fallback to original text if error
        }

        contents.push({
          role: msg.role === "user" ? "user" : "model",
          parts: [{ text: msgText }],
        });
      });
    }

    // Embed current code configuration to give agents supreme awareness
    const contextStr =
      (activeCode
        ? `\n\n[CONTEXT: The user is currently editing a plugin DSP script. Here is the active code:\n\`\`\`javascript\n${activeCode}\n\`\`\`\nParameters available in this scope: ${JSON.stringify(activeParams || [])}]`
        : "") +
      // Ephemeral, best-effort live-web reference (see gatherLiveBuildContext,
      // src/utils/researchEngine.ts) -- this is the only path this string
      // reaches the Gemini cloud provider, since buildRecipeContext/
      // dspRecipes.ts is never imported into this server file at all.
      (discoveryContext
        ? `\n\n[LIVE WEB REFERENCE (background only -- do not copy verbatim, do not brand the plugin after a real product):\n${discoveryContext}]`
        : "");

    contents.push({
      role: "user",
      parts: [{ text: prompt + contextStr }],
    });

    const runnerInstruction = `You are a unified conversational audio plugin creator & DSP peer assistant.
The user is speaking to you like ChatGPT/Gemini to learn, design, or tweak audio plugins.
Keep your text response conversational, direct, and focused on cooperating with the user like an experienced senior engineer colleague.

CRITICAL RULES FOR CONVERSATIONAL EXPERIENCE & INTENT AWARENESS:
1. Speak naturally as a single expert. Do NOT use fake corporate memos, rigid sub-agent headers, or excessive structured sections unless the user explicitly requests a formal multi-specialist memo report.
2. Tailor your response length to the request. If the user asks a quick question or a minor adjustment, reply with a focused, conversational response rather than a giant lecture. If they ask for deep details, explain beautifully.
3. Your JSON structure MUST contain:
   a. "text": Your conversational markdown reply. Directly address the user's prompt. Speak with professional warmth. Feel free to explain code highlights, parameters, or suggest features, but keep it very human and interactive.
   b. "updatedPlugin": Set this ONLY if the user's message implies creating, modifying, tuning, optimizing, or fixing the active DSP code, parameters, names, or categories. If the user is just asking a question (conceptual, math, etc.) without requesting code modifications, set "updatedPlugin" to null.
4. If modifying the plugin, preserve as much of the existing code structure as possible while injecting/improving the requested features. Don't throw away unrelated working parameters or code unless asked.

${RESPONSE_STYLE_RULES}

${DSP_CODING_RULES}

${SOUND_QUALITY_RULES}

${AMP_CAB_SCHEMA_GUIDANCE}

${SAMPLER_SCHEMA_GUIDANCE}

Specific Agent Profile and instructions: ${systemInstruction || ""}`;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents,
      config: {
        systemInstruction: runnerInstruction,
        temperature: typeof temperature === "number" ? temperature : 0.6,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            text: {
              type: Type.STRING,
              description: "The main markdown conversational text response. Keep it friendly, helpful, and highly detailed. Use equations if necessary."
            },
            updatedPlugin: {
              type: Type.OBJECT,
              description: "Populate with the fully assembled AudioPlugin object ONLY if updating code, sliders, description, name, or fixing bugs. Let it be null if you are only answering questions without changing any plugin state.",
              properties: {
                pluginName: { type: Type.STRING, description: "A compact, highly creative title for the audio plugin" },
                category: {
                  type: Type.STRING,
                  description: "Must be exactly one of: distortion, delay, filter, synthesizer, dynamics, modulation, reverb"
                },
                description: { type: Type.STRING, description: "A creative, premium 2-sentence summary of what this plugin sounds like" },
                parameters: {
                  type: Type.ARRAY,
                  description: "List of active interactive sliders binding to DSP params",
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      id: { type: Type.STRING, description: "Unique parameter ID, e.g. 'freq', 'cutoff'" },
                      name: { type: Type.STRING, description: "Capitalized display title, e.g. 'Cutoff Frequency'" },
                      min: { type: Type.NUMBER },
                      max: { type: Type.NUMBER },
                      defaultValue: { type: Type.NUMBER },
                      unit: { type: Type.STRING, description: "Units like 'Hz', '%', 'dB', 'ms'" },
                      ...PARAMETER_VISUAL_SCHEMA_PROPS
                    },
                    required: ["id", "name", "min", "max", "defaultValue", "unit"]
                  }
                },
                dspFunction: {
                  type: Type.STRING,
                  description: "The complete javascript DSP processing function body itself. Receives (inputSample, params, state). E.g. 'if(!state.x) state.x=0; return inputSample;'"
                },
                faustCode: { type: Type.STRING, description: "The beautiful corresponding Faust implementation script file." },
                cppJuceCode: { type: Type.STRING, description: "The corresponding premium real-time-safe C++ JUCE processBlock container." }
              },
              required: ["pluginName", "category", "description", "parameters", "dspFunction", "faustCode", "cppJuceCode"]
            }
          },
          required: ["text"]
        }
      },
    });

    // Send the raw JSON text directly back; client will parse the full payload containing { text, updatedPlugin }
    const resText = response.text;
    res.json(JSON.parse(resText || '{"text": "Failed to generate response."}'));
  } catch (error: any) {
    handleApiError(error, res, "An unexpected error occurred during chat.");
  }
});

// 4. Detailed DSP & Code Integrity report
app.post("/api/plugins/analyze", async (req, res) => {
  try {
    const { code, parameters } = req.body;

    if (!code) {
      return res.status(400).json({ error: "DSP Code is required for stability testing." });
    }

    const ai = getGenAI();

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: `Perform high-fidelity safety check, stability, and DSP purity check on this audio processing script:\n\n\`\`\`javascript\n${code}\n\`\`\`\nParameters used: ${JSON.stringify(parameters || [])}`,
      config: {
        systemInstruction: "You are Decibel, a legendary senior DSP testing specialist. Analyze the JavaScript code for numerical instability, memory leaks (e.g. recreating arrays inside processing loop), potential clipping, sound distortion, aliasing thresholds, DC offset, or infinity issues.",
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            purityScore: { type: Type.INTEGER, description: "Purity and cleanliness rating from 0 to 100" },
            stabilityAssessment: { type: Type.STRING, description: "e.g., Highly Stable, Unstable on High Resonance, Potential Zero Divide, DC Offset Vulnerable" },
            performanceEstimate: { type: Type.STRING, description: "O-notation or CPU burden assessment, e.g. Extremely Lightweight O(1)" },
            mathCritique: { type: Type.STRING, description: "Vivid, constructive 2-sentence summary of the mathematical logic" },
            suggestions: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  category: { type: Type.STRING, description: "What type of threat, e.g., Division by Zero, Variable Blowup, Memory Leak, Clipping" },
                  snippet: { type: Type.STRING, description: "The unstable statement from instructions" },
                  issue: { type: Type.STRING, description: "Explanation of why this statement is vulnerable" },
                  recommendationCode: { type: Type.STRING, description: "Optimized, safe code replace suggestion" }
                },
                required: ["category", "snippet", "issue", "recommendationCode"]
              }
            }
          },
          required: ["purityScore", "stabilityAssessment", "performanceEstimate", "mathCritique", "suggestions"]
        },
        temperature: 0.1,
      }
    });

    const textResult = response.text;
    if (!textResult) {
      throw new Error("No analysis returned from model.");
    }

    res.json(JSON.parse(textResult));
  } catch (error: any) {
    handleApiError(error, res, "Failed to analyze code stability.");
  }
});


// Helper to identify local/private IP addresses or hostnames
const isLocalOrPrivateAddress = (urlStr: string): boolean => {
  try {
    const url = new URL(urlStr);
    const hostname = url.hostname.toLowerCase();
    
    if (
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "0.0.0.0" ||
      hostname.startsWith("192.168.") ||
      hostname.startsWith("10.") ||
      hostname.startsWith("169.254.")
    ) {
      return true;
    }
    
    // Check for 172.16.x.x - 172.31.x.x (RFC 1918)
    if (hostname.startsWith("172.")) {
      const parts = hostname.split(".");
      if (parts.length >= 2) {
        const secondOctet = parseInt(parts[1], 10);
        if (secondOctet >= 16 && secondOctet <= 31) {
          return true;
        }
      }
    }
    
    return false;
  } catch (e) {
    return false;
  }
};

// 5. Native VST3 build pipeline: real JUCE/CMake project scaffold + real compile.
//    Requires the server to be running locally (npm run dev / npm start) with
//    CMake and a C++ toolchain (MSVC or MinGW) on PATH -- this will not work
//    in a hosted/cloud sandbox with no access to the local machine.
app.post("/api/native/scaffold", async (req, res) => {
  try {
    const { plugin, llmConfig } = req.body;
    if (!plugin || !plugin.name || !Array.isArray(plugin.parameters) || !plugin.dspFunction || !plugin.resolvedUi) {
      return res.status(400).json({ error: "A gated plugin object with name, parameters, dspFunction, and resolvedUi is required." });
    }
    if (!llmConfig || (llmConfig.provider !== "ollama" && llmConfig.provider !== "lm_studio")) {
      return res.status(400).json({ error: "Native build requires a local LLM provider (ollama or lm_studio) to translate the DSP core to C++." });
    }

    const result = await scaffoldNativeProject(plugin, llmConfig);
    // The on-disk directory is server-private. The browser gets only the
    // opaque handle it must present to start this exact scaffold.
    const { projectDir: _privateProjectDir, ...publicResult } = result;
    res.json(publicResult);
  } catch (error: any) {
    handleApiError(error, res, "Failed to scaffold native JUCE project.");
  }
});

app.post("/api/audio-projects/native/scaffold", async (req, res) => {
  try {
    const { project, llmConfig } = req.body || {};
    if (!llmConfig || (llmConfig.provider !== "ollama" && llmConfig.provider !== "lm_studio")) {
      return res.status(400).json({ error: "Native build requires a local LLM provider (ollama or lm_studio) to translate the DSP core to C++." });
    }
    const plugin = audioProjectToNativePlugin(project);
    const result = await scaffoldNativeProject(plugin, llmConfig);
    const { projectDir: _privateProjectDir, ...publicResult } = result;
    res.json({ ...publicResult, projectId: project.id, projectKind: project.kind });
  } catch (error: any) {
    handleApiError(error, res, "Failed to scaffold native audio project.");
  }
});

app.post("/api/native/build", (req, res) => {
  try {
    const { scaffoldId, llmConfig } = req.body;
    if (!scaffoldId || typeof scaffoldId !== "string") {
      return res.status(400).json({ error: "A server-issued scaffoldId is required." });
    }
    // llmConfig is optional: with it, compile failures get real
    // error-driven repair passes before the passthrough fallback.
    const buildId = startNativeBuildForScaffold(scaffoldId, llmConfig);
    res.json({ buildId });
  } catch (error: any) {
    handleApiError(error, res, "Failed to start native build.");
  }
});

app.get("/api/native/build/:buildId", (req, res) => {
  const job = getBuildJob(req.params.buildId);
  if (!job) {
    return res.status(404).json({ error: "Unknown build id." });
  }
  res.json({
    status: job.status,
    log: job.log.join(""),
    artifactName: job.status === "success" && job.vst3Path ? path.basename(job.vst3Path) : undefined,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    attempts: job.attempts,
    repairHistory: job.repairHistory,
    usedPassthroughFallback: job.usedPassthroughFallback,
  });
});

// Open the built .vst3's containing folder in Explorer, for the user to inspect it themselves.
app.post("/api/native/reveal", async (req, res) => {
  try {
    const { buildId } = req.body || {};
    const artifact = getCompletedBuildArtifact(buildId);
    if (!artifact) return res.status(400).json({ error: "A completed server-owned buildId is required." });
    const { spawn } = await import("node:child_process");
    spawn("explorer.exe", [`/select,${artifact}`], { shell: false });
    res.json({ ok: true });
  } catch (error: any) {
    handleApiError(error, res, "Failed to open Explorer.");
  }
});

// Copy the built .vst3 bundle into the machine's system VST3 folder so a DAW picks it up.
// Only ever runs when the user explicitly clicks the corresponding button client-side.
app.post("/api/native/install", async (req, res) => {
  try {
    const { buildId } = req.body || {};
    const artifact = getCompletedBuildArtifact(buildId);
    if (!artifact) return res.status(400).json({ error: "A completed server-owned buildId is required." });

    const fs = await import("node:fs");
    const path = await import("node:path");
    if (!fs.existsSync(artifact)) {
      return res.status(400).json({ error: "That .vst3 path no longer exists." });
    }

    const systemVst3Dir = process.env.COMMONPROGRAMFILES
      ? path.join(process.env.COMMONPROGRAMFILES, "VST3")
      : "C:\\Program Files\\Common Files\\VST3";
    fs.mkdirSync(systemVst3Dir, { recursive: true });

    const dest = path.join(systemVst3Dir, path.basename(artifact));
    fs.cpSync(artifact, dest, { recursive: true, force: true });

    res.json({ ok: true, artifactName: path.basename(dest) });
  } catch (error: any) {
    handleApiError(error, res, "Failed to install the plugin to the system VST3 folder.");
  }
});

// 6. Secure LLM & Local Tunnel Proxy to bypass all browser Mixed Content or CORS limits
app.post("/api/proxy", async (req, res) => {
  let cleanup: (() => void) | undefined;
  try {
    const { targetUrl, method, headers, body } = req.body;
    const checked = validateProxyRequest(targetUrl, method, headers);
    const addresses = process.env.NODE_ENV === "production" ? await assertPublicProxyTarget(checked.url) : undefined;
    if (body !== undefined && JSON.stringify(body).length > 1_000_000) return res.status(413).json({ error: "Proxy request body exceeds the size limit." });
    const abort = requestAbortSignal(req, res);
    cleanup = abort.cleanup;

    // Append bypass headers to skip browser splash warning screens on ngrok or localtunnel
    const enrichedHeaders: Record<string, string> = {
      "Content-Type": "application/json",
      "bypass-tunnel-reminder": "true",
      "ngrok-skip-browser-warning": "true",
      "User-Agent": "local-llm-proxy-agent",
      ...checked.headers
    };

    const fetchOptions: RequestInit = {
      method: checked.method,
      headers: enrichedHeaders,
    };

    if (body) {
      fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
    }

    console.log(`[Proxy Link] forwarding ${checked.method} request to ${checked.url}`);
    const serializedBody = fetchOptions.body as string | undefined;
    const pinned = addresses ? await pinnedProxyRequest(checked.url, checked.method, enrichedHeaders, serializedBody, addresses[0], abort.signal) : undefined;
    const upstream = pinned ? undefined : await fetch(checked.url, { ...fetchOptions, signal: abort.signal, redirect: "error" });
    const responseText = pinned ? pinned.text : await readResponseLimited(upstream!);
    let jsonPayload: any = null;

    try {
      jsonPayload = JSON.parse(responseText);
    } catch (e) {
      // Body may not be JSON
    }

    // Always answer 200 from the relay itself: the upstream's status lives in
    // the payload. Mirroring it (the old behavior) made an upstream 404 like
    // Ollama's "model 'x' not found" indistinguishable from the relay route
    // being missing -- the client reported "Server proxy failed with code
    // 404" instead of the actual, actionable model error.
    res.json({
      status: pinned?.status ?? upstream!.status,
      ok: pinned?.ok ?? upstream!.ok,
      responseText,
      jsonPayload
    });
  } catch (error: any) {
    console.error(`[Proxy Failure] could not reach target URL:`, error);
    const status = error?.name === "AbortError" ? 504 : /must be|Only HTTP|credentials|Only GET|Private|size limit/i.test(error.message || "") ? 400 : 502;
    res.status(status).json({
      error: `The local server/tunnel is offline, unreachable, or refused the connection. Error: ${error.message}. Please verify your tunnel is active and running correctly.` 
    });
  } finally { cleanup?.(); }
});

// Configure Vite middleware in Dev, static file serving in Production
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Setting up Vite server in development mode.");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Setting up Express static serve in production mode.");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Plugin Factory running at http://localhost:${PORT}`);
  });
}

startServer();
