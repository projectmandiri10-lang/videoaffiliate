import { GoogleGenAI, Modality } from "@google/genai";
import type { FastifyBaseLogger } from "fastify";
import type { GenerateSpeechInput, SpeechGenerator } from "../types.js";
import { getRetryDelayMs, isTransientLlmError } from "../utils/llm-error.js";
import { extractAudioFromResponse } from "../utils/model-output.js";
import { withRetry } from "../utils/retry.js";

interface GeminiTtsClient {
  models: {
    generateContent(input: unknown): Promise<unknown>;
  };
}

function buildGeminiTtsPrompt(input: GenerateSpeechInput): string {
  const paceInstruction =
    input.speechRate >= 1.1
      ? "Pace: sedikit cepat, tetap jelas dan tidak terburu-buru."
      : input.speechRate <= 0.9
        ? "Pace: sedikit lebih pelan, tetap natural dan tidak datar."
        : "Pace: natural untuk voice-over video pendek.";

  return [
    "# AUDIO PROFILE",
    "Narator affiliate video pendek berbahasa Indonesia.",
    "",
    "### DIRECTORS NOTES",
    "Language: Bahasa Indonesia (id-ID).",
    "Accent: penutur asli Indonesia, natural, jelas, dan hangat.",
    "Style: voice-over promosi yang terdengar realistis, tidak kaku, tidak seperti robot.",
    paceInstruction,
    "Pronunciation: utamakan pelafalan kata Indonesia secara lokal, bukan aksen Inggris atau Amerika.",
    "",
    "### TRANSCRIPT",
    input.text
  ].join("\n");
}

export class GeminiTtsService implements SpeechGenerator {
  private readonly client: GeminiTtsClient;

  public constructor(
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: GeminiTtsClient
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  public async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<{ data: Buffer; mimeType: string }> {
    const response = await withRetry(
      () =>
        this.client.models.generateContent({
          model: input.model,
          contents: [
            {
              role: "user",
              parts: [{ text: buildGeminiTtsPrompt(input) }]
            }
          ],
          config: {
            responseModalities: [Modality.AUDIO],
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
        getDelayMs: (error, _attempt, fallbackDelayMs) => getRetryDelayMs(error, fallbackDelayMs)
      }
    );

    const audio = extractAudioFromResponse(response);
    this.logger.debug(
      { model: input.model, voiceName: input.voiceName, mimeType: audio.mimeType },
      "Gemini TTS audio generated."
    );
    return audio;
  }
}
