import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GeminiTtsService,
  normalizeGeminiTtsModel
} from "../src/services/litellm-tts-service.js";

describe("GeminiTtsService", () => {
  const logger = pino({ level: "silent" });
  const createCompletion = vi.fn();
  const service = new GeminiTtsService(
    {
      apiKey: "litellm-secret",
      baseURL: "http://127.0.0.1:4000/v1"
    },
    logger,
    {
      chat: {
        completions: {
          create: createCompletion
        }
      }
    }
  );

  beforeEach(() => {
    createCompletion.mockReset();
  });

  it("maps legacy Gemini TTS model names to direct Gemini model IDs", () => {
    expect(normalizeGeminiTtsModel("vertex_ai/gemini-2.5-flash-tts")).toBe(
      "gemini-2.5-flash-preview-tts"
    );
    expect(normalizeGeminiTtsModel("gemini-2.5-pro-preview-tts")).toBe(
      "gemini-2.5-pro-preview-tts"
    );
  });

  it("requests Gemini TTS audio with the configured model and voice", async () => {
    const audioBytes = Uint8Array.from(Buffer.from("gemini-audio"));
    createCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            audio: {
              data: Buffer.from(audioBytes).toString("base64"),
              transcript: "Halo, ini voice over."
            }
          }
        }
      ]
    });

    const audio = await service.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Halo, ini voice over.",
      voiceName: "Kore",
      speechRate: 1
    });

    expect(audio.data.toString("utf8")).toBe("gemini-audio");
    expect(audio.mimeType).toBe("audio/pcm");
    expect(createCompletion).toHaveBeenCalledTimes(1);
    expect(createCompletion).toHaveBeenCalledWith({
      model: "gemini/gemini-2.5-flash-preview-tts",
      messages: [
        {
          role: "user",
          content: "Halo, ini voice over."
        }
      ],
      modalities: ["text", "audio"],
      audio: {
        voice: "Kore",
        format: "wav"
      },
      extra_body: {
        allowed_openai_params: ["audio", "modalities"]
      }
    });
  });
});
