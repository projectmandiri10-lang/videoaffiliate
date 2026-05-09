import type { FastifyBaseLogger } from "fastify";
import type { GenerateSpeechInput, SpeechGenerator } from "../types.js";
import { extractErrorMessage } from "../utils/llm-error.js";

export class FallbackSpeechGenerator implements SpeechGenerator {
  public constructor(
    private readonly fallback: SpeechGenerator,
    private readonly logger: FastifyBaseLogger,
    private readonly primary?: SpeechGenerator
  ) {}

  public async generateSpeech(
    input: GenerateSpeechInput
  ): Promise<{ data: Buffer; mimeType: string }> {
    if (!this.primary) {
      return this.fallback.generateSpeech(input);
    }

    try {
      return await this.primary.generateSpeech(input);
    } catch (error) {
      this.logger.warn(
        { err: error, model: input.model, voiceName: input.voiceName },
        "LiteLLM TTS gagal, fallback ke Windows local TTS."
      );
      try {
        return await this.fallback.generateSpeech(input);
      } catch (fallbackError) {
        throw new Error(
          `TTS API utama gagal: ${extractErrorMessage(error)}. Fallback voice lokal juga tidak bisa dipakai: ${extractErrorMessage(fallbackError)}`
        );
      }
    }
  }
}
