import type { FastifyBaseLogger } from "fastify";
import { GoogleGenAI } from "@google/genai";
import type { GenerateSpeechInput, SpeechGenerator } from "../types.js";
import {
  extractErrorMessage,
  extractStatusCode,
  getRetryDelayMs,
  isTransientLlmError
} from "../utils/llm-error.js";
import { extractAudioFromResponse } from "../utils/model-output.js";
import {
  DEFAULT_GEMINI_TTS_MODEL,
  normalizeGeminiTtsModel
} from "../utils/gemini-models.js";
import { withRetry } from "../utils/retry.js";

interface GeminiAudioClient {
  models: {
    generateContent(input: unknown): Promise<unknown>;
  };
}

const GEMINI_TTS_MODEL_FALLBACKS = [
  DEFAULT_GEMINI_TTS_MODEL,
  "gemini-3.1-flash-tts-preview",
  "gemini-2.5-pro-preview-tts"
];

function isWavContainer(data: Buffer): boolean {
  return data.length >= 12 && data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WAVE";
}

function buildGeminiTtsTranscript(input: GenerateSpeechInput): string {
  if (input.speechRate >= 1.1) {
    return `[very fast] ${input.text}`;
  }
  if (input.speechRate <= 0.9) {
    return `[very slow] ${input.text}`;
  }
  return input.text;
}

export class GeminiTtsService implements SpeechGenerator {
  private readonly client: GeminiAudioClient;

  public constructor(
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: GeminiAudioClient
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  public async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<{ data: Buffer; mimeType: string }> {
    const resolvedModel = normalizeGeminiTtsModel(input.model);
    let lastError: unknown;

    for (const model of this.listTtsModels(resolvedModel)) {
      try {
        const response = await withRetry(
          () =>
            this.client.models.generateContent({
              model,
              contents: buildGeminiTtsTranscript(input),
              config: {
                responseModalities: ["AUDIO"],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: input.voiceName
                    }
                  }
                }
              }
            }),
          {
            attempts: 3,
            baseDelayMs: 700,
            shouldRetry: isTransientLlmError,
            getDelayMs: (error, _attempt, fallbackDelayMs) =>
              getRetryDelayMs(error, fallbackDelayMs)
          }
        );

        if (model !== resolvedModel) {
          this.logger.warn(
            { requestedModel: input.model, fallbackModel: model },
            "Gemini TTS dipindah ke model fallback."
          );
        }

        const audio = extractAudioFromResponse(response);
        const mimeType = isWavContainer(audio.data) ? "audio/wav" : "audio/pcm";

        this.logger.debug(
          {
            requestedModel: input.model,
            resolvedModel: model,
            voiceName: input.voiceName,
            mimeType
          },
          "Gemini TTS audio generated."
        );

        return {
          data: audio.data,
          mimeType
        };
      } catch (error) {
        lastError = error;
        if (!this.shouldTryAlternativeModel(error)) {
          throw this.normalizeTtsError(error, input.model);
        }

        this.logger.warn(
          { err: error, requestedModel: input.model, fallbackModel: model },
          "Generate TTS Gemini gagal di model ini, mencoba fallback berikutnya."
        );
      }
    }

    throw this.normalizeTtsError(
      lastError ?? new Error("Gemini mengembalikan audio kosong."),
      input.model
    );
  }

  private listTtsModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...GEMINI_TTS_MODEL_FALLBACKS])];
  }

  private shouldTryAlternativeModel(error: unknown): boolean {
    const statusCode = extractStatusCode(error);
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }

    const message = extractErrorMessage(error).toLowerCase();
    return (
      !statusCode ||
      [400, 404, 408, 409, 423, 425, 429, 500, 502, 503, 504].includes(statusCode) ||
      message.includes("not found") ||
      message.includes("unsupported") ||
      message.includes("unavailable") ||
      message.includes("invalid model") ||
      message.includes("invalid_argument") ||
      message.includes("timeout") ||
      message.includes("quota")
    );
  }

  private normalizeTtsError(error: unknown, requestedModel: string): Error {
    const statusCode = extractStatusCode(error);
    const message = extractErrorMessage(error);
    const lowerMessage = message.toLowerCase();

    if (
      statusCode === 404 ||
      lowerMessage.includes("not found") ||
      lowerMessage.includes("invalid model")
    ) {
      return new Error(
        `${message}. Ganti ttsModel (${requestedModel}) ke model Gemini TTS yang aktif, misalnya ${DEFAULT_GEMINI_TTS_MODEL}.`
      );
    }

    if (statusCode === 429) {
      return new Error(
        `${message}. Gemini API sedang membatasi permintaan; cek kuota atau rate limit API key Anda.`
      );
    }

    return error instanceof Error ? error : new Error(message);
  }
}

export { normalizeGeminiTtsModel };
