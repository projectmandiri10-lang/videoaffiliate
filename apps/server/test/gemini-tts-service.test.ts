import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { GeminiTtsService } from "../src/services/gemini-tts-service.js";

describe("GeminiTtsService", () => {
  const logger = pino({ level: "silent" });
  const generateContent = vi.fn();
  const service = new GeminiTtsService("gemini-tts-test", logger, {
    models: {
      generateContent
    }
  });

  beforeEach(() => {
    generateContent.mockReset();
  });

  it("requests Gemini TTS audio with the configured model and voice", async () => {
    generateContent.mockResolvedValue({
      candidates: [
        {
          content: {
            parts: [
              {
                inlineData: {
                  data: Buffer.from("gemini-audio").toString("base64"),
                  mimeType: "audio/wav"
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
    expect(audio.mimeType).toBe("audio/wav");
    expect(generateContent).toHaveBeenCalledTimes(1);
    expect(generateContent.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini-2.5-flash-preview-tts",
      contents: [
        {
          role: "user"
        }
      ],
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
    const promptText = generateContent.mock.calls[0]?.[0]?.contents?.[0]?.parts?.[0]?.text;
    expect(promptText).toContain("Language: Bahasa Indonesia (id-ID).");
    expect(promptText).toContain("Accent: penutur asli Indonesia");
    expect(promptText).toContain("Halo, ini voice over.");
  });
});
