import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LiteLlmTtsService,
  normalizeLiteLlmTtsModel
} from "../src/services/litellm-tts-service.js";

describe("LiteLlmTtsService", () => {
  const logger = pino({ level: "silent" });
  const createSpeech = vi.fn();
  const service = new LiteLlmTtsService("http://localhost:4000/v1", "litellm-secret", logger, {
    audio: {
      speech: {
        create: createSpeech
      }
    }
  });

  beforeEach(() => {
    createSpeech.mockReset();
  });

  it("maps legacy Gemini TTS model names to LiteLLM aliases", () => {
    expect(normalizeLiteLlmTtsModel("gemini-2.5-flash-preview-tts")).toBe(
      "vertex_ai/gemini-2.5-flash-tts"
    );
    expect(normalizeLiteLlmTtsModel("gemini-2.5-pro-preview-tts")).toBe(
      "vertex_ai/gemini-2.5-pro-tts"
    );
  });

  it("requests LiteLLM TTS audio with the configured model and voice", async () => {
    const audioBytes = Uint8Array.from(Buffer.from("litellm-audio"));
    createSpeech.mockResolvedValue({
      arrayBuffer: async () => audioBytes.buffer.slice(0)
    });

    const audio = await service.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Halo, ini voice over.",
      voiceName: "Kore",
      speechRate: 1
    });

    expect(audio.data.toString("utf8")).toBe("litellm-audio");
    expect(audio.mimeType).toBe("audio/wav");
    expect(createSpeech).toHaveBeenCalledTimes(1);
    expect(createSpeech).toHaveBeenCalledWith({
      model: "vertex_ai/gemini-2.5-flash-tts",
      voice: "Kore",
      input: "Halo, ini voice over.",
      response_format: "wav",
      speed: 1,
      instructions: expect.stringContaining("Language: Bahasa Indonesia (id-ID).")
    });
    expect(createSpeech.mock.calls[0]?.[0]?.instructions).toContain(
      "Accent: penutur asli Indonesia"
    );
  });
});
