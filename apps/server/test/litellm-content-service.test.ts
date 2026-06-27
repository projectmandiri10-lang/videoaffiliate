import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { GeminiContentService } from "../src/services/litellm-content-service.js";

describe("GeminiContentService", () => {
  const logger = pino({ level: "silent" });
  const createCompletion = vi.fn();
  const frameDataUrl = `data:image/jpeg;base64,${Buffer.from("frame-01").toString("base64")}`;

  const service = new GeminiContentService(
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

  it("sends multimodal frames for script generation", async () => {
    createCompletion.mockReset();
    createCompletion.mockResolvedValue({ text: "Naskah Gemini final." });

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
    expect(createCompletion).toHaveBeenCalledTimes(1);
    const firstCall = createCompletion.mock.calls[0]?.[0] as {
      model?: string;
      messages?: Array<{
        content?: Array<{
          type?: string;
          text?: string;
          image_url?: { url?: string };
        }>;
      }>;
    };
    expect(firstCall).toMatchObject({
      model: "gemini/gemini-2.5-pro"
    });
    const content = firstCall.messages?.[0]?.content ?? [];
    expect(content[0]?.text).toContain("Analisis video ini");
    expect(content.some((part) => part.text?.includes("Frame 1 pada 2.70 detik."))).toBe(true);
    expect(
      content.some((part) => part.image_url?.url === frameDataUrl)
    ).toBe(true);
  });

  it("falls back to another vision model before text-only", async () => {
    createCompletion.mockReset();
    createCompletion
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
      createCompletion.mock.calls.some(
        (call) =>
          (call[0] as { model?: string })?.model === "gemini/gemini-3.1-flash-image-preview"
      )
    ).toBe(true);
    expect(createCompletion.mock.calls[2]?.[0]).toMatchObject({
      model: "gemini/gemini-3.1-flash-image-preview"
    });
  });

  it("falls back to text-only when vision models fail", async () => {
    createCompletion.mockReset();
    createCompletion
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
    expect(createCompletion.mock.calls[4]?.[0]).toMatchObject({
      model: "gemini/gemini-2.5-flash-image",
      messages: [
        {
          role: "user",
          content: "Analisis video ini"
        }
      ]
    });
  });

  it("requests json_object response format for social metadata", async () => {
    createCompletion.mockReset();
    createCompletion.mockResolvedValue({
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
    expect(createCompletion.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini/gemini-2.5-pro",
      response_format: {
        type: "json_object"
      }
    });
  });

  it("adds a helpful message when the requested model is missing", async () => {
    createCompletion.mockReset();
    createCompletion.mockRejectedValue({
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
