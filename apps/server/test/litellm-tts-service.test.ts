import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  GeminiTtsService,
  normalizeGeminiTtsModel
} from "../src/services/litellm-tts-service.js";

describe("GeminiTtsService", () => {
  const logger = pino({ level: "silent" });
  const generateContent = vi.fn();
  const service = new GeminiTtsService("gemini-secret", logger, {
    models: {
      generateContent
    }
  });

  beforeEach(() => {
    generateContent.mockReset();
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
    generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from(audioBytes).toString("base64"),
                  mimeType: "audio/L16"
                }
              }
            ]
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
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent).toHaveBeenCalledWith({
      model: "gemini-2.5-flash-preview-tts",
      contents: "Halo, ini voice over.",
      config: {
        responseModalities: ["AUDIO"],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName: "Kore"
            }
          }
        }
      }
    });
  });
});
