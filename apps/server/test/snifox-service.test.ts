import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SnifoxService } from "../src/services/snifox-service.js";

describe("SnifoxService", () => {
  const logger = pino({ level: "silent" });
  const filesCreate = vi.fn();
  const chatCreate = vi.fn();
  const tempDir = path.join(process.env.APP_STORAGE_ROOT || process.cwd(), "snifox-service-test");
  const tempVideoPath = path.join(tempDir, "source.mp4");

  const service = new SnifoxService("https://core.snifoxai.com/v1", "snfx-test", logger, {
    files: {
      create: filesCreate
    },
    chat: {
      completions: {
        create: chatCreate
      }
    }
  });

  beforeEach(() => {
    filesCreate.mockReset();
    chatCreate.mockReset();
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("uploads video with SnifoxAI target model metadata", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempVideoPath, "fake-video", "utf8");
    filesCreate.mockResolvedValue({
      id: "file-video-1",
      filename: "source.mp4"
    });

    const file = await service.uploadVideo(
      tempVideoPath,
      "video/mp4",
      "google/gemini-3-flash-preview"
    );

    expect(file).toEqual({
      fileId: "file-video-1",
      filename: "source.mp4",
      mimeType: "video/mp4"
    });
    expect(filesCreate).toHaveBeenCalledTimes(1);
    expect(filesCreate.mock.calls[0]?.[0]).toMatchObject({
      purpose: "user_data",
      target_model_names: "google/gemini-3-flash-preview"
    });
  });

  it("falls back to text-only mode when /v1/files is unavailable", async () => {
    await mkdir(tempDir, { recursive: true });
    await writeFile(tempVideoPath, "fake-video-inline", "utf8");
    filesCreate.mockRejectedValue({
      status: 404,
      message: "404 Cannot POST /v1/files"
    });

    const file = await service.uploadVideo(
      tempVideoPath,
      "video/mp4",
      "google/gemini-3-flash-preview"
    );

    expect(file.fileId).toBeUndefined();
    expect(file.filename).toBe("source.mp4");
    expect(file.mimeType).toBe("video/mp4");
    expect(file.inlineDataBase64).toBeUndefined();
  });

  it("reuses uploaded file id for script generation", async () => {
    chatCreate.mockResolvedValue({
      choices: [
        {
          message: {
            content: "Naskah SnifoxAI final."
          }
        }
      ]
    });

    const script = await service.generateScript({
      model: "google/gemini-3-flash-preview",
      prompt: "Analisis video ini",
      video: {
        fileId: "file-video-99",
        filename: "video.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(script).toBe("Naskah SnifoxAI final.");
    expect(chatCreate).toHaveBeenCalledTimes(1);
    expect(chatCreate.mock.calls[0]?.[0]).toMatchObject({
      model: "google/gemini-3-flash-preview"
    });
    expect(chatCreate.mock.calls[0]?.[0]?.messages?.[0]?.content?.[1]?.file).toMatchObject({
      file_id: "file-video-99",
      filename: "video.mp4",
      format: "video/mp4"
    });
  });

  it("falls back to a text-only model when SnifoxAI cannot use the uploaded video", async () => {
    chatCreate
      .mockRejectedValueOnce({
        status: 404,
        message: "404 status code (no body)"
      })
      .mockRejectedValueOnce({
        status: 404,
        message: "404 status code (no body)"
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
      model: "google/gemini-3-flash-preview",
      prompt: "Analisis video inline ini",
      video: {
        filename: "video.mp4",
        mimeType: "video/mp4"
      }
    });

    expect(script).toBe("Naskah fallback text-only.");
    expect(chatCreate).toHaveBeenCalledTimes(3);
    expect(chatCreate.mock.calls[0]?.[0]).toMatchObject({
      model: "google/gemini-3-flash-preview",
      messages: [{ role: "user", content: "Analisis video inline ini" }]
    });
    expect(chatCreate.mock.calls[1]?.[0]).toMatchObject({
      model: "google/gemini-3-flash-preview",
      messages: [
        {
          role: "user",
          content:
            "Analisis video inline ini\n\nKembalikan hanya satu paragraf naskah final tanpa format markdown."
        }
      ]
    });
    expect(chatCreate.mock.calls[2]?.[0]).toMatchObject({
      model: "openai/gpt-5-mini",
      messages: [{ role: "user", content: "Analisis video inline ini" }]
    });
  });

  it("adds a helpful message when SnifoxAI cannot find a model", async () => {
    chatCreate.mockRejectedValue({
      status: 404,
      message: "404 status code (no body)"
    });

    await expect(
      service.generateScript({
        model: "gemini-3-flash-preview",
        prompt: "Analisis video ini",
        video: {
          filename: "video.mp4",
          mimeType: "video/mp4",
          inlineDataBase64: Buffer.from("inline-video").toString("base64")
        }
      })
    ).rejects.toThrow(/openai\/gpt-5-mini|endpoint \/models/i);
  });

  it("requests json_object response format for social metadata", async () => {
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
      model: "google/gemini-3-flash-preview",
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

  it("falls back to a working text model for social metadata when the requested model fails", async () => {
    chatCreate
      .mockRejectedValueOnce({
        status: 404,
        message: "404 status code (no body)"
      })
      .mockResolvedValueOnce({
        choices: [
          {
            message: {
              content: '{"caption":"Fallback caption.","hashtags":["#fallback"]}'
            }
          }
        ]
      });

    const social = await service.generateSocialMetadata({
      model: "google/gemini-3-flash-preview",
      title: "Sabun Wajah",
      description: "Bantu kulit terasa bersih.",
      platformId: "tiktok",
      scriptText: "Naskah singkat",
      ctaText: "cek detailnya sekarang"
    });

    expect(social).toEqual({
      caption: "Fallback caption.",
      hashtags: ["#fallback"]
    });
    expect(chatCreate.mock.calls[1]?.[0]).toMatchObject({
      model: "openai/gpt-5-mini"
    });
  });

});
