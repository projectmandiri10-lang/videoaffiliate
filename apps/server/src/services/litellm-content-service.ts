import type { FastifyBaseLogger } from "fastify";
import { GoogleGenAI, createPartFromBase64, createPartFromText } from "@google/genai";
import type {
  AIService,
  AnalyzeClipCandidatesInput,
  AnalysisFrame,
  ClipCandidate,
  GenerateScriptInput,
  GenerateSocialMetadataInput,
  SocialMetadata
} from "../types.js";
import {
  extractErrorMessage,
  extractStatusCode,
  getRetryDelayMs,
  isTransientLlmError
} from "../utils/llm-error.js";
import {
  extractClipCandidateScores,
  extractScriptText,
  extractSocialMetadata
} from "../utils/model-output.js";
import { parseDataUrl } from "../utils/gemini-models.js";
import { withRetry } from "../utils/retry.js";
import { buildClipSelectionPrompt, buildReelsMetadataPrompt } from "./prompt-builder.js";

interface GeminiModelsClient {
  models: {
    generateContent(input: unknown): Promise<unknown>;
  };
}

const VISION_MODEL_FALLBACKS = [
  "gemini-2.5-flash-image",
  "gemini-3.1-flash-image-preview"
];

const TEXT_MODEL_FALLBACKS = ["gemini-2.5-flash", "gemini-3-flash-preview"];

function buildContentParts(prompt: string, frames: AnalysisFrame[]) {
  return [
    createPartFromText(prompt),
    ...frames.flatMap((frame, index) => {
      const parsed = parseDataUrl(frame.dataUrl);
      return [
        createPartFromText(`Frame ${index + 1} pada ${frame.timestampSec.toFixed(2)} detik.`),
        createPartFromBase64(parsed.base64, parsed.mimeType)
      ];
    })
  ];
}

function buildClipCandidateContentParts(input: AnalyzeClipCandidatesInput) {
  const prompt = buildClipSelectionPrompt({
    title: input.title,
    description: input.description,
    affiliateLink: input.affiliateLink,
    candidates: input.candidates.map((candidate) => ({
      clipId: candidate.clipId,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      durationSec: candidate.durationSec
    }))
  });

  return [
    createPartFromText(prompt),
    ...input.candidates.flatMap((candidate) => [
      createPartFromText(
        `Kandidat ${candidate.clipId} pada ${candidate.startSec.toFixed(2)}-${candidate.endSec.toFixed(2)} detik.`
      ),
      ...candidate.frames.flatMap((frame, index) => {
        const parsed = parseDataUrl(frame.dataUrl);
        return [
          createPartFromText(
            `Frame ${index + 1} kandidat ${candidate.clipId} pada ${frame.timestampSec.toFixed(2)} detik.`
          ),
          createPartFromBase64(parsed.base64, parsed.mimeType)
        ];
      })
    ])
  ];
}

export class GeminiContentService implements AIService {
  private readonly client: GeminiModelsClient;

  public constructor(
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: GeminiModelsClient
  ) {
    this.client = client ?? new GoogleGenAI({ apiKey });
  }

  public async generateScript(input: GenerateScriptInput): Promise<string> {
    const prompts = this.buildPromptVariants(input.prompt);
    let lastVisionError: unknown;

    if (input.frames.length > 0) {
      for (const model of this.listVisionModels(input.model)) {
        for (const prompt of prompts) {
          try {
            const response = await this.createContent({
              model,
              contents: buildContentParts(
                `${prompt}\n\nGunakan frame video berikut untuk memahami konteks visual video.`,
                input.frames
              )
            });
            const script = extractScriptText(response);
            if (script) {
              if (model !== input.model) {
                this.logger.warn(
                  { requestedModel: input.model, fallbackModel: model },
                  "Generate script video-aware dipindah ke model Gemini fallback."
                );
              }
              return script;
            }

            this.logger.warn(
              { model },
              "Script multimodal kosong dari Gemini, mencoba prompt atau model berikutnya."
            );
          } catch (error) {
            lastVisionError = error;
            if (!this.shouldTryAlternativeModel(error)) {
              throw this.normalizeGenerateError(error, input.model);
            }

            this.logger.warn(
              { err: error, requestedModel: input.model, fallbackModel: model },
              "Generate script multimodal gagal di model ini, mencoba fallback vision Gemini lain."
            );
          }
        }
      }

      this.logger.warn(
        { err: lastVisionError, model: input.model },
        "Semua percobaan vision Gemini gagal, fallback ke generate script text-only."
      );
    } else {
      this.logger.warn(
        { model: input.model },
        "Frame analisis video tidak tersedia, fallback ke generate script text-only."
      );
    }

    return this.generateScriptTextOnly(input.model, prompts, lastVisionError);
  }

  public async generateSocialMetadata(
    input: GenerateSocialMetadataInput
  ): Promise<SocialMetadata> {
    const prompt = buildReelsMetadataPrompt({
      title: input.title,
      description: input.description,
      platformId: input.platformId,
      scriptText: input.scriptText,
      ctaText: input.ctaText
    });

    let lastError: unknown;
    for (const model of this.listTextModels(input.model)) {
      try {
        const response = await this.createContent({
          model,
          contents: [createPartFromText(prompt)],
          config: {
            responseMimeType: "application/json"
          }
        });

        if (model !== input.model) {
          this.logger.warn(
            { requestedModel: input.model, fallbackModel: model },
            "Caption/hashtags dipindah ke model Gemini fallback."
          );
        }

        return extractSocialMetadata(response);
      } catch (error) {
        lastError = error;
        if (!this.shouldTryAlternativeModel(error)) {
          throw this.normalizeGenerateError(error, input.model);
        }

        this.logger.warn(
          { err: error, requestedModel: input.model, fallbackModel: model },
          "Generate caption/hashtags gagal di model ini, mencoba fallback text Gemini lain."
        );
      }
    }

    throw this.normalizeGenerateError(
      lastError ?? new Error("Gemini gagal membuat caption dan hashtags."),
      input.model
    );
  }

  public async analyzeClipCandidates(input: AnalyzeClipCandidatesInput): Promise<ClipCandidate[]> {
    let lastError: unknown;

    for (const model of this.listVisionModels(input.model)) {
      try {
        const response = await this.createContent({
          model,
          contents: buildClipCandidateContentParts(input),
          config: {
            responseMimeType: "application/json"
          }
        });
        const parsed = extractClipCandidateScores(response);
        if (!parsed.length) {
          continue;
        }

        const byClipId = new Map(parsed.map((candidate) => [candidate.clipId, candidate]));
        return input.candidates.map((candidate) => {
          const scored = byClipId.get(candidate.clipId);
          return {
            clipId: candidate.clipId,
            startSec: candidate.startSec,
            endSec: candidate.endSec,
            durationSec: candidate.durationSec,
            frameTimestamps: candidate.frameTimestamps,
            previewPath: undefined,
            score: scored?.score ?? 0,
            reason: scored?.reason || "Potongan ini layak, tetapi alasan spesifik tidak diberikan model."
          };
        });
      } catch (error) {
        lastError = error;
        if (!this.shouldTryAlternativeModel(error)) {
          throw this.normalizeGenerateError(error, input.model);
        }

        this.logger.warn(
          { err: error, requestedModel: input.model, fallbackModel: model },
          "Analisis kandidat clip gagal di model ini, mencoba fallback vision Gemini lain."
        );
      }
    }

    throw this.normalizeGenerateError(
      lastError ?? new Error("Gemini gagal menilai kandidat clip."),
      input.model
    );
  }

  private async generateScriptTextOnly(
    preferredModel: string,
    prompts: string[],
    lastError?: unknown
  ): Promise<string> {
    for (const model of this.listTextModels(preferredModel)) {
      for (const prompt of prompts) {
        try {
          const response = await this.createContent({
            model,
            contents: [createPartFromText(prompt)]
          });
          const script = extractScriptText(response);
          if (!script) {
            this.logger.warn(
              { model },
              "Script text-only kosong dari Gemini, mencoba prompt atau model berikutnya."
            );
            continue;
          }

          if (model !== preferredModel) {
            this.logger.warn(
              { requestedModel: preferredModel, fallbackModel: model },
              "Script dipindah ke model Gemini fallback."
            );
          }

          return script;
        } catch (error) {
          lastError = error;
          if (!this.shouldTryAlternativeModel(error)) {
            throw this.normalizeGenerateError(error, preferredModel);
          }

          this.logger.warn(
            { err: error, requestedModel: preferredModel, fallbackModel: model },
            "Generate script text-only gagal di model ini, mencoba fallback Gemini lain."
          );
        }
      }
    }

    throw this.normalizeGenerateError(
      lastError ?? new Error("Gemini mengembalikan script kosong."),
      preferredModel
    );
  }

  private buildPromptVariants(prompt: string): string[] {
    return [
      prompt,
      `${prompt}\n\nKembalikan hanya satu paragraf naskah final tanpa format markdown.`
    ];
  }

  private listVisionModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...VISION_MODEL_FALLBACKS])];
  }

  private listTextModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...TEXT_MODEL_FALLBACKS])];
  }

  private async createContent(input: Record<string, unknown>): Promise<unknown> {
    return withRetry(() => this.client.models.generateContent(input), {
      attempts: 3,
      baseDelayMs: 700,
      shouldRetry: isTransientLlmError,
      getDelayMs: (error, _attempt, fallbackDelayMs) => getRetryDelayMs(error, fallbackDelayMs)
    });
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
      message.includes("image") ||
      message.includes("vision") ||
      message.includes("multimodal") ||
      message.includes("timeout") ||
      message.includes("quota")
    );
  }

  private normalizeGenerateError(error: unknown, requestedModel: string): Error {
    const statusCode = extractStatusCode(error);
    const message = extractErrorMessage(error);
    const lowerMessage = message.toLowerCase();

    if (
      statusCode === 404 ||
      lowerMessage.includes("not found") ||
      lowerMessage.includes("invalid model")
    ) {
      return new Error(
        `${message}. Pastikan scriptModel memakai ID model Gemini yang didukung, misalnya gemini-2.5-pro.`
      );
    }

    if (statusCode === 400 && (lowerMessage.includes("image") || lowerMessage.includes("vision"))) {
      return new Error(
        `${message}. Model ${requestedModel} tidak bisa memproses input vision lewat Gemini. Pilih model vision yang aktif, misalnya gemini-2.5-pro.`
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
