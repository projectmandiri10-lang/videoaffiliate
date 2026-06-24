import {
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES,
  extractAudioFromResponse
} from "@app/core";
import type {
  AnalyzeClipCandidatesInput,
  ClipCandidate,
  GenerateSocialMetadataInput,
  SocialMetadata,
  TtsVoiceOption
} from "@app/core";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE?.trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }
  return "";
}

const API_BASE = resolveApiBase();

async function parseJsonResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new Error(body.error ? `${body.message || "Error"}: ${body.error}` : body.message || `HTTP ${response.status}`);
  }
  return (await response.json()) as T;
}

export async function fetchTtsVoicesFromProxy(): Promise<{
  voices: TtsVoiceOption[];
  excitedPresets: typeof GEMINI_EXCITED_PRESETS;
}> {
  const response = await fetch(`${API_BASE}/api/tts/voices`);
  if (!response.ok) {
    return {
      voices: GEMINI_TTS_VOICES,
      excitedPresets: GEMINI_EXCITED_PRESETS
    };
  }
  return parseJsonResponse(response);
}

export async function analyzeCandidatesWithProxy(
  input: AnalyzeClipCandidatesInput
): Promise<ClipCandidate[]> {
  const response = await fetch(`${API_BASE}/api/ai/analyze`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return parseJsonResponse<ClipCandidate[]>(response);
}

export async function generateScriptWithProxy(input: {
  model: string;
  prompt: string;
  frames: Array<{
    dataUrl: string;
    timestampSec: number;
  }>;
}): Promise<string> {
  const response = await fetch(`${API_BASE}/api/ai/script`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = await parseJsonResponse<{ script: string }>(response);
  return body.script;
}

export async function generateMetadataWithProxy(
  input: GenerateSocialMetadataInput
): Promise<SocialMetadata> {
  const response = await fetch(`${API_BASE}/api/ai/metadata`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return parseJsonResponse<SocialMetadata>(response);
}

export async function generateTtsWithProxy(input: {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
}): Promise<{ data: Uint8Array; mimeType: string }> {
  const response = await fetch(`${API_BASE}/api/ai/tts`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  const body = await parseJsonResponse<{
    mimeType: string;
    audioBase64: string;
  }>(response);
  return extractAudioFromResponse({
    candidates: [
      {
        content: {
          parts: [
            {
              inlineData: {
                data: body.audioBase64,
                mimeType: body.mimeType
              }
            }
          ]
        }
      }
    ]
  });
}
