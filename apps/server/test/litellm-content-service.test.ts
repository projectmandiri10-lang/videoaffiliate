import pino from "pino";
import { describe, expect, it, vi } from "vitest";
import { LiteLlmContentService } from "../src/services/litellm-content-service.js";

describe("LiteLlmContentService", () => {
  const logger = pino({ level: "silent" });
  const chatCreate = vi.fn();

  const service = new LiteLlmContentService("http://localhost:4000/v1", "litellm-secret", logger, {
    chat: {
      completions: {
        create: chatCreate
      }
    }
  });

  it("sends multimodal frames for script generation", async () => {
    chatCreate.mockReset();
    chatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Naskah LiteLLM final."
          }
        }
      ]
    });

    const script = await service.generateScript({
      model: "gemini/gemini-2.5-flash-image",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: "https://contoh.test/frame-01.jpg",
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah LiteLLM final.");
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate.mock.calls[0]?.[0]).toMatchObject({
      model: "gemini/gemini-2.5-flash-image"
    });
    expect(chatCreate.mock.calls[0]?.[0]?.messages?.[0]?.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "text" }),
        expect.objectContaining({
          type: "image_url",
          image_url: { url: "https://contoh.test/frame-01.jpg" }
        })
      ])
    );
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
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Naskah fallback vision."
            }
          }
        ]
      });

    const script = await service.generateScript({
      model: "gemini/gemini-2.5-flash-image",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: "https://contoh.test/frame-01.jpg",
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah fallback vision.");
    expect(chatCreate.mock.calls[2]?.[0]).toMatchObject({
      model: "gemini/gemini-3.1-flash-image-preview"
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
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: "Naskah fallback text-only."
            }
          }
        ]
      });

    const script = await service.generateScript({
      model: "gemini/gemini-2.5-flash-image",
      prompt: "Analisis video ini",
      frames: [
        {
          dataUrl: "https://contoh.test/frame-01.jpg",
          timestampSec: 2.7
        }
      ]
    });

    expect(script).toBe("Naskah fallback text-only.");
    expect(chatCreate.mock.calls[4]?.[0]).toMatchObject({
      model: "gemini/gemini-2.5-flash-image",
      messages: [{ role: "user", content: "Analisis video ini" }]
    });
  });

  it("requests json_object response format for social metadata", async () => {
    chatCreate.mockReset();
    chatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: '{"caption":"Caption final.","hashtags":["#affiliate"]}'
          }
        }
      ]
    });

    const social = await service.generateSocialMetadata({
      model: "gemini/gemini-2.5-flash-image",
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
    expect(chatCreate.mock.calls[0]?.[0]?.response_format).toMatchObject({
      type: "json_object"
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
        model: "gemini/gemini-unknown",
        title: "Sabun Wajah",
        description: "Bantu kulit terasa bersih.",
        platformId: "tiktok",
        scriptText: "Naskah singkat",
        ctaText: "cek detailnya sekarang"
      })
    ).rejects.toThrow(/LiteLLM.*\/models|gemini\/gemini-2.5-flash-image/i);
  });
});
