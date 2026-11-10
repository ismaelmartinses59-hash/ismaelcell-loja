import { GoogleGenAI } from "@google/genai";

let _ai: GoogleGenAI | null = null;
let _aiWithRetries: GoogleGenAI | null = null;

/**
 * Lazily builds (and caches) the Gemini client. Validation of the integration
 * env vars happens here, on first use — NOT at module import time — so that
 * simply importing this module never crashes a server where the Gemini
 * integration isn't provisioned (e.g. external hosts like Railway). The AI
 * feature only fails if it is actually invoked without the integration.
 */
function createAi(retryAttempts?: number): GoogleGenAI {
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Provide a Google Gemini API key (or provision the Replit Gemini integration).",
    );
  }

  // Two supported modes:
  // - Replit AI Integrations proxy: BASE_URL is set → route through the proxy
  //   (apiVersion must be "" so the proxy path isn't rewritten).
  // - Direct Google Gemini API (e.g. external hosts like Railway): only the
  //   API key is set → let the SDK use its default Google endpoint.
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;

  const httpOptions = {
    ...(baseUrl ? { apiVersion: "", baseUrl } : {}),
    ...(retryAttempts ? { retryOptions: { attempts: retryAttempts } } : {}),
  };

  return new GoogleGenAI({
    apiKey,
    httpOptions,
  });
}

export function getAi(): GoogleGenAI {
  if (_ai) return _ai;
  _ai = createAi();
  return _ai;
}

export function getAiWithRetries(): GoogleGenAI {
  if (_aiWithRetries) return _aiWithRetries;
  _aiWithRetries = createAi(3);
  return _aiWithRetries;
}

/**
 * Backwards-compatible export. Accessing any property proxies to the lazily
 * constructed client, so existing callers can keep using `ai.models...`
 * unchanged while import stays side-effect free.
 */
export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop, receiver) {
    const instance = getAi();
    const value = Reflect.get(instance, prop, instance);
    return typeof value === "function" ? value.bind(instance) : value;
  },
});
