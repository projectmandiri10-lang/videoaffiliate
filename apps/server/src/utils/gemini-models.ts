export const DEFAULT_GEMINI_SCRIPT_MODEL = "gemini-3.5-flash";
export const DEFAULT_GEMINI_TTS_MODEL = "gemini-2.5-flash-preview-tts";

const SUPPORTED_GEMINI_SCRIPT_MODELS = new Set([
  DEFAULT_GEMINI_SCRIPT_MODEL,
  "gemini-3.1-flash-lite",
  "gemini-3-flash-preview",
  "gemini-2.5-flash"
]);

const LEGACY_GEMINI_SCRIPT_MODEL_ALIASES: Record<string, string> = {
  "gemini/gemini-2.5-flash-image": "gemini-2.5-flash",
  "gemini-2.5-flash-image": "gemini-2.5-flash",
  "gemini/gemini-2.5-pro": DEFAULT_GEMINI_SCRIPT_MODEL,
  "google/gemini-2.5-pro": DEFAULT_GEMINI_SCRIPT_MODEL,
  "google/gemini-2.5-flash-image": "gemini-2.5-flash",
  "gemini/gemini-3.1-flash-image-preview": "gemini-3.1-flash-lite",
  "gemini/gemini-2.5-flash": "gemini-2.5-flash",
  "gemini/gemini-3-flash-preview": "gemini-3-flash-preview",
  "google/gemini-3.1-flash-image-preview": "gemini-3.1-flash-lite",
  "google/gemini-2.5-flash": "gemini-2.5-flash",
  "google/gemini-3-flash-preview": "gemini-3-flash-preview",
  "gemini/gemini-3.5-flash": DEFAULT_GEMINI_SCRIPT_MODEL,
  "google/gemini-3.5-flash": DEFAULT_GEMINI_SCRIPT_MODEL,
  "gemini/gemini-3.1-flash-lite": "gemini-3.1-flash-lite",
  "google/gemini-3.1-flash-lite": "gemini-3.1-flash-lite"
};

const LEGACY_GEMINI_TTS_MODEL_ALIASES: Record<string, string> = {
  "vertex_ai/gemini-2.5-flash-tts": DEFAULT_GEMINI_TTS_MODEL,
  "gemini-2.5-flash-tts": DEFAULT_GEMINI_TTS_MODEL,
  "gemini/gemini-2.5-flash-tts": DEFAULT_GEMINI_TTS_MODEL,
  "gemini-2.5-flash-preview-tts": DEFAULT_GEMINI_TTS_MODEL,
  "gemini/gemini-2.5-flash-preview-tts": DEFAULT_GEMINI_TTS_MODEL,
  "vertex_ai/gemini-2.5-pro-tts": "gemini-2.5-pro-preview-tts",
  "gemini-2.5-pro-tts": "gemini-2.5-pro-preview-tts",
  "gemini/gemini-2.5-pro-tts": "gemini-2.5-pro-preview-tts",
  "gemini-2.5-pro-preview-tts": "gemini-2.5-pro-preview-tts",
  "gemini/gemini-2.5-pro-preview-tts": "gemini-2.5-pro-preview-tts",
  "gemini-2.5-flash-lite-preview-tts": DEFAULT_GEMINI_TTS_MODEL,
  "gemini/gemini-2.5-flash-lite-preview-tts": DEFAULT_GEMINI_TTS_MODEL
};

function stripProviderPrefix(model: string): string {
  const clean = model.trim();
  if (clean.startsWith("models/") || clean.startsWith("tunedModels/")) {
    return clean;
  }

  const slashIndex = clean.indexOf("/");
  if (slashIndex > 0) {
    return clean.slice(slashIndex + 1);
  }

  return clean;
}

export function normalizeGeminiScriptModel(model: string): string {
  const cleaned = stripProviderPrefix(model);
  const resolved = LEGACY_GEMINI_SCRIPT_MODEL_ALIASES[cleaned] ?? cleaned;
  if (!resolved) {
    return DEFAULT_GEMINI_SCRIPT_MODEL;
  }
  return SUPPORTED_GEMINI_SCRIPT_MODELS.has(resolved) ? resolved : resolved;
}

export function normalizeGeminiTtsModel(model: string): string {
  const cleaned = stripProviderPrefix(model);
  return LEGACY_GEMINI_TTS_MODEL_ALIASES[cleaned] ?? cleaned;
}

export function toLiteLlmGeminiModel(model: string): string {
  const cleaned = model.trim();
  if (!cleaned) {
    return `gemini/${DEFAULT_GEMINI_SCRIPT_MODEL}`;
  }

  if (cleaned.includes("/")) {
    return cleaned;
  }

  return `gemini/${cleaned}`;
}

export function parseDataUrl(dataUrl: string): { mimeType: string; base64: string } {
  const trimmed = dataUrl.trim();
  const match = trimmed.match(/^data:([^;,]+)(?:;charset=[^;,]+)?;base64,(.+)$/i);
  if (!match) {
    throw new Error("Format data URL frame tidak valid.");
  }

  const mimeType = match[1]?.trim();
  const base64 = match[2]?.trim();
  if (!mimeType || !base64) {
    throw new Error("Format data URL frame tidak valid.");
  }

  return {
    mimeType,
    base64
  };
}
