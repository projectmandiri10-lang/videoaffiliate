import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { GeminiContentService } from "../src/services/litellm-content-service.js";

describe("GeminiContentService", () => {
  const logger = pino({ level: "silent" });
  const chatCreate = vi.fn();
  const frameDataUrl = `data:image/jpeg;base64,${Buffer.from("frame-01").toString("base64")}`;

  const service = new GeminiContentService("gemini-secret", logger, {
    models: {
      generateContent: chatCreate
    }
  });

  it("sends multimodal frames for script generation", async () => {
    chatCreate.mockReset();
    chatCreate.mockResolvedValue({ text: "Naskah Gemini final." });

    const script = await service.generateScript({
      model: "gemini-2.5-pro",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: frameDataUrl,
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah Gemini final.");
    expect(chatCreate).toHaveBeenCalledTimes(1);
    const firstCall = chatCreate.mock.calls[0]?.[0] as {
      model?: string;
      contents?: Array<{ text?: string; inlineData?: { mimeType?: string } }>;
    };
    expect(firstCall).toMatchObject({
      model: "gemini-2.5-pro"
    });
    expect(firstCall.contents?.[0]?.text).toContain("Analisis video ini");
    expect(firstCall.contents?.some((part) => part.text?.includes("Frame 1 pada 2.70 detik."))).toBe(true);
    expect(
      firstCall.contents?.some((part) => part.inlineData?.mimeType === "image/jpeg")
    ).toBe(true);
  });

  it("falls back to another vision model before text-only", async () => {
    chatCreate.mockReset();
    chatCreate
      .mockRejectedValueOnce({
        status: 404,
        message: "404 model not found"
      })
      .mockRejectedValueOnce({
        status: 404,
        message: "404 model not found"
      })
      .mockResolvedValueOnce({ text: "Naskah fallback vision." });

    const script = await service.generateScript({
      model: "gemini-2.5-flash-image",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: frameDataUrl,
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah fallback vision.");
    expect(
      chatCreate.mock.calls.some(
        (call) => (call[0] as { model?: string })?.model === "gemini-3.1-flash-image-preview"
      )
    ).toBe(true);
    expect(chatCreate.mock.calls[2]?.[0]).toMatchObject({
      model: "gemini-3.1-flash-image-preview"
    });
  });

  it("falls back to text-only when vision models fail", async () => {
    chatCreate.mockReset();
    chatCreate
      .mockRejectedValueOnce({
        status: 400,
        message: "Provided image is not valid."
      })
      .mockRejectedValueOnce({
        status: 400,
        message: "Provided image is not valid."
      })
      .mockRejectedValueOnce({
        status: 400,
        message: "vision unsupported"
      })
      .mockRejectedValueOnce({
        status: 400,
        message: "vision unsupported"
      })
      .mockResolvedValueOnce({ text: "Naskah fallback text-only." });

    const script = await service.generateScript({
      model: "gemini-2.5-flash-image",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: frameDataUrl,
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah fallback text-only.");
    expect(chatCreate.mock.calls[4]?.[0]).toMatchObject({
      model: "gemini-2.5-flash-image",
      contents: [expect.objectContaining({ text: "Analisis video ini" })]
    });
  });

  it("requests json_object response format for social metadata", async () => {
    chatCreate.mockReset();
    chatCreate.mockResolvedValue({
      text: '{"caption":"Caption final.","hashtags":["#affiliate"]}'
    });

    const social = await service.generateSocialMetadata({
      model: "gemini-2.5-pro",
      title: "Sabun Wajah",
      description: "Bantu kulit terasa bersih.",
      platformId: "tiktok",
      scriptText: "Naskah singkat",
      ctaText: "cek detailnya sekarang"
    });

    expect(social).toEqual({
      caption: "Caption final.",
      hashtags: ["#affiliate"]
    });
    expect(chatCreate.mock.calls[0]?.[0]?.config).toMatchObject({
      responseMimeType: "application/json"
    });
  });

  it("adds a helpful message when the requested model is missing", async () => {
    chatCreate.mockReset();
    chatCreate.mockRejectedValue({
      status: 404,
      message: "404 model not found"
    });

    await expect(
      service.generateSocialMetadata({
        model: "gemini-unknown",
        title: "Sabun Wajah",
        description: "Bantu kulit terasa bersih.",
        platformId: "tiktok",
        scriptText: "Naskah singkat",
        ctaText: "cek detailnya sekarang"
      })
    ).rejects.toThrow(/Gemini.*model|gemini-2.5-pro/i);
  });
});
