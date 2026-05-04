import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import OpenAI from "openai";
import type {
  AIService,
  GenerateScriptInput,
  GenerateSocialMetadataInput,
  SocialMetadata,
  UploadedModelFile
} from "../types.js";
import {
  extractErrorMessage,
  extractStatusCode,
  getRetryDelayMs,
  isTransientLlmError
} from "../utils/llm-error.js";
import {
  extractSocialMetadata,
  extractScriptText
} from "../utils/model-output.js";
import { withRetry } from "../utils/retry.js";
import {
  prepareVideoForModelUpload,
  type PreparedModelVideo
} from "../utils/video.js";
import { buildReelsMetadataPrompt } from "./prompt-builder.js";

interface OpenAiLikeClient {
  files: {
    create(input: unknown): Promise<{ id: string; filename?: string }>;
  };
  chat: {
    completions: {
      create(input: unknown): Promise<unknown>;
    };
  };
}

const TEXT_MODEL_FALLBACKS = [
  "google/gemini-3-flash-preview",
  "anthropic/claude-sonnet-4.5",
  "anthropic/claude-opus-4.6"
];

type VideoUploadPreparer = (filePath: string, mimeType: string) => Promise<PreparedModelVideo>;

export class SnifoxService implements AIService {
  private readonly client: OpenAiLikeClient;

  public constructor(
    apiBase: string,
    apiKey: string,
    private readonly logger: FastifyBaseLogger,
    client?: OpenAiLikeClient,
    private readonly prepareUploadVideo: VideoUploadPreparer = prepareVideoForModelUpload
  ) {
    this.client =
      client ??
      new OpenAI({
        apiKey,
        baseURL: apiBase,
        maxRetries: 0
      });
  }

  public async uploadVideo(
    filePath: string,
    mimeType: string,
    targetModel: string
  ): Promise<UploadedModelFile> {
    let prepared: PreparedModelVideo;
    try {
      prepared = await this.prepareUploadVideo(filePath, mimeType);
      if (prepared.compressed) {
        this.logger.info(
          {
            sourceBytes: prepared.originalBytes,
            uploadBytes: prepared.uploadBytes,
            filePath: prepared.filePath
          },
          "Video source terlalu besar untuk gateway, memakai versi analisis kecil untuk SnifoxAI."
        );
      }

      const uploaded = await withRetry(
        async () =>
          this.client.files.create({
            file: createReadStream(prepared.filePath),
            purpose: "user_data",
            // SnifoxAI gateway accepts provider-routing metadata on /v1/files.
            target_model_names: targetModel
          }),
        {
          attempts: 3,
          baseDelayMs: 700,
          shouldRetry: isTransientLlmError,
          getDelayMs: (error, _attempt, fallbackDelayMs) =>
            getRetryDelayMs(error, fallbackDelayMs)
        }
      );

      if (!uploaded?.id) {
        throw new Error("Upload video ke SnifoxAI gagal: file_id tidak tersedia.");
      }

      return {
        fileId: uploaded.id,
        filename: uploaded.filename || path.basename(prepared.filePath),
        mimeType: prepared.mimeType
      };
    } catch (error) {
      if (!this.canFallbackToTextOnly(error)) {
        throw error;
      }

      this.logger.warn(
        { err: error, filePath },
        "Video tidak bisa diunggah ke SnifoxAI, lanjutkan dengan fallback script text-only."
      );

      return {
        filename: path.basename(filePath),
        mimeType
      };
    }
  }

  public async generateScript(input: GenerateScriptInput): Promise<string> {
    const prompts = this.buildPromptVariants(input.prompt);
    let lastError: unknown;

    if (input.video.fileId) {
      for (const prompt of prompts) {
        try {
          const response = await this.createChatCompletion({
            model: input.model,
            messages: this.buildVideoPromptMessages(prompt, input.video)
          });
          const script = extractScriptText(response);
          if (script) {
            return script;
          }

          this.logger.warn(
            { model: input.model },
            "Script multimodal kosong dari SnifoxAI, mencoba prompt berikutnya."
          );
        } catch (error) {
          lastError = error;
          if (!this.shouldTryAlternativeModel(error)) {
            throw error;
          }

          this.logger.warn(
            { err: error, model: input.model },
            "Script multimodal SnifoxAI gagal, fallback ke model text-only."
          );
          break;
        }
      }
    } else {
      this.logger.warn(
        { model: input.model },
        "Video tidak bisa dipakai di SnifoxAI, fallback ke generate script text-only."
      );
    }

    return this.generateScriptTextOnly(input.model, prompts, lastError);
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
            "Caption/hashtags dipindah ke model fallback SnifoxAI."
          );
        }

        return extractSocialMetadata(response);
      } catch (error) {
        lastError = error;
        if (!this.shouldTryAlternativeModel(error)) {
          throw error;
        }

        this.logger.warn(
          { err: error, requestedModel: input.model, fallbackModel: model },
          "Generate caption/hashtags gagal di model ini, mencoba model text-only lain."
        );
      }
    }

    throw lastError ?? new Error("SnifoxAI gagal membuat caption dan hashtags.");
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
              "Script text-only kosong dari SnifoxAI, mencoba prompt atau model berikutnya."
            );
            continue;
          }

          if (model !== preferredModel) {
            this.logger.warn(
              { requestedModel: preferredModel, fallbackModel: model },
              "Script dipindah ke model fallback SnifoxAI."
            );
          }

          return script;
        } catch (error) {
          lastError = error;
          if (!this.shouldTryAlternativeModel(error)) {
            throw error;
          }

          this.logger.warn(
            { err: error, requestedModel: preferredModel, fallbackModel: model },
            "Generate script text-only gagal di model ini, mencoba model fallback lain."
          );
        }
      }
    }

    throw lastError ?? new Error("SnifoxAI mengembalikan script kosong.");
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

  private buildVideoPromptMessages(prompt: string, file: UploadedModelFile) {
    return [
      {
        role: "user",
        content: [
          {
            type: "text",
            text: prompt
          },
          {
            type: "file",
            file: {
              ...(file.fileId ? { file_id: file.fileId } : {}),
              ...(file.inlineDataBase64 ? { file_data: file.inlineDataBase64 } : {}),
              filename: file.filename,
              // SnifoxAI accepts Gemini format hints for uploaded files.
              format: file.mimeType
            }
          }
        ]
      }
    ];
  }

  private listTextModels(preferredModel: string): string[] {
    return [...new Set([preferredModel, ...TEXT_MODEL_FALLBACKS])];
  }

  private async createChatCompletion(input: Record<string, unknown>): Promise<unknown> {
    try {
      return await withRetry(() => this.client.chat.completions.create(input), {
        attempts: 3,
        baseDelayMs: 700,
        shouldRetry: isTransientLlmError,
        getDelayMs: (error, _attempt, fallbackDelayMs) => getRetryDelayMs(error, fallbackDelayMs)
      });
    } catch (error) {
      if (extractStatusCode(error) === 404) {
        const message = extractErrorMessage(error);
        const lowerMessage = message.toLowerCase();
        if (lowerMessage.includes("currently unavailable")) {
          throw new Error(
            `${message}. Model SnifoxAI ini sedang tidak tersedia di gateway. Ganti scriptModel ke model aktif dari endpoint /models, misalnya google/gemini-3-flash-preview.`
          );
        }
        throw new Error(
          `${message}. Pastikan model SnifoxAI tersedia di endpoint /models dan memakai ID lengkap, misalnya google/gemini-3-flash-preview.`
        );
      }
      throw error;
    }
  }

  private isFilesEndpointUnavailable(error: unknown): boolean {
    const statusCode = extractStatusCode(error);
    const message = extractErrorMessage(error).toLowerCase();
    return (
      statusCode === 404 &&
      (message.includes("/v1/files") ||
        message.includes("cannot post /v1/files") ||
        message.includes("not found"))
    );
  }

  private isPayloadTooLarge(error: unknown): boolean {
    const statusCode = extractStatusCode(error);
    const message = extractErrorMessage(error).toLowerCase();
    return (
      statusCode === 413 ||
      message.includes("request entity too large") ||
      message.includes("payload too large") ||
      message.includes("entity too large") ||
      message.includes("content too large")
    );
  }

  private canFallbackToTextOnly(error: unknown): boolean {
    return this.isFilesEndpointUnavailable(error) || this.isPayloadTooLarge(error);
  }

  private shouldTryAlternativeModel(error: unknown): boolean {
    const statusCode = extractStatusCode(error);
    if (statusCode === 401 || statusCode === 403) {
      return false;
    }

    const message = extractErrorMessage(error).toLowerCase();
    return (
      !statusCode ||
      [404, 408, 409, 423, 425, 429, 500, 502, 503, 504].includes(statusCode) ||
      message.includes("all upstream providers failed") ||
      message.includes("not found") ||
      message.includes("unsupported") ||
      message.includes("timeout") ||
      message.includes("unavailable")
    );
  }
}
