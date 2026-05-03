import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { FallbackSpeechGenerator } from "../src/services/fallback-speech-generator.js";

describe("FallbackSpeechGenerator", () => {
  const logger = pino({ level: "silent" });

  it("returns the primary speech result when Gemini succeeds", async () => {
    const primary = {
      generateSpeech: vi.fn().mockResolvedValue({
        data: Buffer.from("gemini"),
        mimeType: "audio/wav"
      })
    };
    const fallback = {
      generateSpeech: vi.fn()
    };
    const generator = new FallbackSpeechGenerator(fallback, logger, primary);

    const result = await generator.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Halo",
      voiceName: "Kore",
      speechRate: 1
    });

    expect(result.data.toString("utf8")).toBe("gemini");
    expect(fallback.generateSpeech).not.toHaveBeenCalled();
  });

  it("falls back to local speech when Gemini TTS fails", async () => {
    const primary = {
      generateSpeech: vi.fn().mockRejectedValue(new Error("403 PERMISSION_DENIED"))
    };
    const fallback = {
      generateSpeech: vi.fn().mockResolvedValue({
        data: Buffer.from("windows"),
        mimeType: "audio/wav"
      })
    };
    const generator = new FallbackSpeechGenerator(fallback, logger, primary);

    const result = await generator.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Halo",
      voiceName: "Kore",
      speechRate: 1
    });

    expect(result.data.toString("utf8")).toBe("windows");
    expect(fallback.generateSpeech).toHaveBeenCalledTimes(1);
  });

  it("returns a clear error when both TTS API and local fallback fail", async () => {
    const primary = {
      generateSpeech: vi.fn().mockRejectedValue(new Error("403 PERMISSION_DENIED"))
    };
    const fallback = {
      generateSpeech: vi
        .fn()
        .mockRejectedValue(new Error("Voice lokal Windows untuk Bahasa Indonesia tidak tersedia."))
    };
    const generator = new FallbackSpeechGenerator(fallback, logger, primary);

    await expect(
      generator.generateSpeech({
        model: "gemini-2.5-flash-preview-tts",
        text: "Halo",
        voiceName: "Kore",
        speechRate: 1
      })
    ).rejects.toThrow(/TTS API utama gagal/i);
  });
});
