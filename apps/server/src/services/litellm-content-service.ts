import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";
import type {
  AIService,
  AnalysisFrame,
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
import { extractSocialMetadata, extractScriptText } from "../utils/model-output.js";
import { withRetry } from "../utils/retry.js";
import { buildReelsMetadataPrompt } from "./prompt-builder.js";

interface OpenAiLikeClient {
  chat: {
    completions: {
      create(input: unknown): Promise<unknown>;
    };
  };
}

const VISION_MODEL_FALLBACKS = [
  "gemini/gemini-2.5-flash-image",
  "gemini/gemini-3.1-flash-image-preview"
];

const TEXT_MODEL_FALLBACKS = [
  "gemini-3-flash-preview",
  "gemini/gemini-2.5-flash",
  "openai/gpt-4.1-mini"
];

export class LiteLlmContentService implements AIService {
  private readonly client: OpenAiLikeClient;

  public constructor(
    apiBase: string,
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: OpenAiLikeClient
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey,
        baseURL: apiBase,
        maxRetries: 0
      });
  }

  public async generateScript(input: GenerateScriptInput): Promise<string> {
    const prompts = this.buildPromptVariants(input.prompt);
    let lastVisionError: unknown;

    if (input.frames.length > 0) {
      for (const model of this.listVisionModels(input.model)) {
        for (const prompt of prompts) {
          try {
            const response = await this.createChatCompletion({
              model,
              messages: this.buildVisionPromptMessages(prompt, input.frames)
            });
            const script = extractScriptText(response);
            if (script) {
              if (model !== input.model) {
                this.logger.warn(
                  { requestedModel: input.model, fallbackModel: model },
                  "Script video-aware dipindah ke model fallback LiteLLM."
                );
              }
              return script;
            }

            this.logger.warn(
              { model },
              "Script multimodal kosong dari LiteLLM, mencoba prompt atau model berikutnya."
            );
          } catch (error) {
            lastVisionError = error;
            if (!this.shouldTryAlternativeModel(error)) {
              throw this.normalizeChatCompletionError(error, input.model);
            }

            this.logger.warn(
              { err: error, requestedModel: input.model, fallbackModel: model },
              "Generate script multimodal gagal di model ini, mencoba fallback vision lain."
            );
          }
        }
      }

      this.logger.warn(
        { err: lastVisionError, model: input.model },
        "Semua percobaan vision LiteLLM gagal, fallback ke generate script text-only."
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
        const response = await this.createChatCompletion({
          model,
          messages: this.buildTextPromptMessages(prompt),
          response_format: {
            type: "json_object"
          }
        });

        if (model !== input.model) {
          this.logger.warn(
            { requestedModel: input.model, fallbackModel: model },
            "Caption/hashtags dipindah ke model fallback LiteLLM."
          );
        }

        return extractSocialMetadata(response);
      } catch (error) {
        lastError = error;
        if (!this.shouldTryAlternativeModel(error)) {
          throw this.normalizeChatCompletionError(error, input.model);
        }

        this.logger.warn(
          { err: error, requestedModel: input.model, fallbackModel: model },
          "Generate caption/hashtags gagal di model ini, mencoba fallback text LiteLLM lain."
        );
      }
    }

    throw this.normalizeChatCompletionError(
      lastError ?? new Error("LiteLLM gagal membuat caption dan hashtags."),
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
          const response = await this.createChatCompletion({
            model,
            messages: this.buildTextPromptMessages(prompt)
          });
          const script = extractScriptText(response);
          if (!script) {
            this.logger.warn(
              { model },
              "Script text-only kosong dari LiteLLM, mencoba prompt atau model berikutnya."
            );
            continue;
          }

          if (model !== preferredModel) {
            this.logger.warn(
              { requestedModel: preferredModel, fallbackModel: model },
              "Script dipindah ke model fallback LiteLLM."
            );
          }

          return script;
        } catch (error) {
          lastError = error;
          if (!this.shouldTryAlternativeModel(error)) {
            throw this.normalizeChatCompletionError(error, preferredModel);
          }

          this.logger.warn(
            { err: error, requestedModel: preferredModel, fallbackModel: model },
            "Generate script text-only gagal di model ini, mencoba fallback LiteLLM lain."
          );
        }
      }
    }

    throw this.normalizeChatCompletionError(
      lastError ?? new Error("LiteLLM mengembalikan script kosong."),
      preferredModel
    );
  }

  private buildPromptVariants(prompt: string): string[] {
    return [
      prompt,
      `${prompt}\n\nKembalikan hanya satu paragraf naskah final tanpa format markdown.`
    ];
  }

  private buildTextPromptMessages(prompt: string) {
    return [
      {
        role: "user",
        content: prompt
      }
    ];
  }

  private buildVisionPromptMessages(prompt: string, frames: AnalysisFrame[]) {
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `${prompt}\n\nGunakan frame video berikut untuk memahami konteks visual video.`
          },
          ...frames.flatMap((frame, index) => [
            {
              type: "text",
              text: `Frame ${index + 1} pada ${frame.timestampSec.toFixed(2)} detik.`
            },
            {
              type: "image_url",
              image_url: {
                url: frame.dataUrl
              }
            }
          ])
        ]
      }
    ];
  }

  private listVisionModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...VISION_MODEL_FALLBACKS])];
  }

  private listTextModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...TEXT_MODEL_FALLBACKS])];
  }

  private async createChatCompletion(input: Record<string, unknown>): Promise<unknown> {
    return withRetry(() => this.client.chat.completions.create(input), {
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
      message.includes("all upstream providers failed") ||
      message.includes("not found") ||
      message.includes("unsupported") ||
      message.includes("unavailable") ||
      message.includes("invalid model") ||
      message.includes("invalid_argument") ||
      message.includes("image") ||
      message.includes("vision") ||
      message.includes("multimodal") ||
      message.includes("timeout")
    );
  }

  private normalizeChatCompletionError(error: unknown, requestedModel: string): Error {
    const statusCode = extractStatusCode(error);
    const message = extractErrorMessage(error);
    const lowerMessage = message.toLowerCase();

    if (statusCode === 404 || lowerMessage.includes("not found") || lowerMessage.includes("invalid model")) {
      return new Error(
        `${message}. Pastikan scriptModel tersedia di endpoint LiteLLM /models dan gunakan ID model lengkap, misalnya gemini/gemini-2.5-flash-image.`
      );
    }

    if (statusCode === 400 && (lowerMessage.includes("image") || lowerMessage.includes("vision"))) {
      return new Error(
        `${message}. Model ${requestedModel} tidak bisa memproses input vision lewat LiteLLM. Pilih model vision yang aktif di /models, misalnya gemini/gemini-2.5-flash-image.`
      );
    }

    if (statusCode === 429) {
      return new Error(
        `${message}. LiteLLM atau provider upstream sedang membatasi permintaan; cek kuota, budget, atau rate limit key yang aktif.`
      );
    }

    return error instanceof Error ? error : new Error(message);
  }
}
