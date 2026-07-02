import { GoogleGenAI } from "@google/genai";

let _ai: GoogleGenAI | null = null;

/**
 * Lazily builds (and caches) the Gemini client. Validation of the integration
 * env vars happens here, on first use — NOT at module import time — so that
 * simply importing this module never crashes a server where the Gemini
 * integration isn't provisioned (e.g. external hosts like Railway). The AI
 * feature only fails if it is actually invoked without the integration.
 */
export function getAi(): GoogleGenAI {
  if (_ai) return _ai;

  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_BASE_URL must be set. Did you forget to provision the Gemini AI integration?",
    );
  }

  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set. Did you forget to provision the Gemini AI integration?",
    );
  }

  _ai = new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });

  return _ai;
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
