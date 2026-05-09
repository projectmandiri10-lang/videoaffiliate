import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";
import type { GenerateSpeechInput, SpeechGenerator } from "../types.js";
import {
  extractErrorMessage,
  extractStatusCode,
  getRetryDelayMs,
  isTransientLlmError
} from "../utils/llm-error.js";
import { withRetry } from "../utils/retry.js";

interface LiteLlmTtsResponse {
  arrayBuffer(): Promise<ArrayBuffer>;
}

interface LiteLlmTtsClient {
  audio: {
    speech: {
      create(input: unknown): Promise<LiteLlmTtsResponse>;
    };
  };
}

const LEGACY_GEMINI_TTS_MODEL_ALIASES: Record<string, string> = {
  "gemini-2.5-flash-preview-tts": "vertex_ai/gemini-2.5-flash-tts",
  "gemini/gemini-2.5-flash-preview-tts": "vertex_ai/gemini-2.5-flash-tts",
  "gemini-2.5-flash-tts": "vertex_ai/gemini-2.5-flash-tts",
  "gemini/gemini-2.5-flash-tts": "vertex_ai/gemini-2.5-flash-tts",
  "gemini-2.5-pro-preview-tts": "vertex_ai/gemini-2.5-pro-tts",
  "gemini/gemini-2.5-pro-preview-tts": "vertex_ai/gemini-2.5-pro-tts",
  "gemini-2.5-pro-tts": "vertex_ai/gemini-2.5-pro-tts",
  "gemini/gemini-2.5-pro-tts": "vertex_ai/gemini-2.5-pro-tts",
  "gemini-2.5-flash-lite-preview-tts": "vertex_ai/gemini-2.5-flash-lite-preview-tts",
  "gemini/gemini-2.5-flash-lite-preview-tts": "vertex_ai/gemini-2.5-flash-lite-preview-tts"
};

function buildLiteLlmTtsInstructions(input: GenerateSpeechInput): string {
  const paceInstruction =
    input.speechRate >= 1.1
      ? "Pace: sedikit cepat, tetap jelas dan tidak terburu-buru."
      : input.speechRate <= 0.9
        ? "Pace: sedikit lebih pelan, tetap natural dan tidak datar."
        : "Pace: natural untuk voice-over video pendek.";

  return [
    "Narator affiliate video pendek berbahasa Indonesia.",
    "Language: Bahasa Indonesia (id-ID).",
    "Accent: penutur asli Indonesia, natural, jelas, dan hangat.",
    "Style: voice-over promosi yang terdengar realistis, tidak kaku, tidak seperti robot.",
    paceInstruction,
    "Pronunciation: utamakan pelafalan kata Indonesia secara lokal, bukan aksen Inggris atau Amerika."
  ].join("\n");
}

export function normalizeLiteLlmTtsModel(model: string): string {
  const cleanModel = model.trim();
  return LEGACY_GEMINI_TTS_MODEL_ALIASES[cleanModel] ?? cleanModel;
}

export class LiteLlmTtsService implements SpeechGenerator {
  private readonly client: LiteLlmTtsClient;

  public constructor(
    apiBase: string,
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: LiteLlmTtsClient
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey,
        baseURL: apiBase,
        maxRetries: 0
      });
  }

  public async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<{ data: Buffer; mimeType: string }> {
    const resolvedModel = normalizeLiteLlmTtsModel(input.model);
    let response: LiteLlmTtsResponse;
    try {
      response = await withRetry(
        () =>
          this.client.audio.speech.create({
            model: resolvedModel,
            voice: input.voiceName,
            input: input.text,
            instructions: buildLiteLlmTtsInstructions(input),
            response_format: "wav",
            speed: input.speechRate
          }),
        {
          attempts: 3,
          baseDelayMs: 700,
          shouldRetry: isTransientLlmError,
          getDelayMs: (error, _attempt, fallbackDelayMs) =>
            getRetryDelayMs(error, fallbackDelayMs)
        }
      );
    } catch (error) {
      if (
        extractStatusCode(error) === 400 &&
        extractErrorMessage(error).toLowerCase().includes("invalid model name")
      ) {
        throw new Error(
          `${extractErrorMessage(error)} Ganti ttsModel ke model LiteLLM Gemini TTS yang aktif di /v1/models, misalnya vertex_ai/gemini-2.5-flash-tts.`
        );
      }
      throw error;
    }

    const audio = Buffer.from(await response.arrayBuffer());
    this.logger.debug(
      {
        requestedModel: input.model,
        resolvedModel,
        voiceName: input.voiceName,
        mimeType: "audio/wav"
      },
      "LiteLLM TTS audio generated."
    );
    return {
      data: audio,
      mimeType: "audio/wav"
    };
  }
}
