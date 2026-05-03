import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, PLATFORM_ORDER } from "../src/constants.js";
import { JobProcessor } from "../src/services/job-processor.js";
import { buildReelsMetadataPrompt, buildScriptPrompt } from "../src/services/prompt-builder.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import type { JobRecord } from "../src/types.js";
import { OUTPUTS_DIR, UPLOADS_DIR, outputUrlToAbsolutePath } from "../src/utils/paths.js";
import { resetTestStorage } from "./helpers.js";

vi.mock("../src/utils/audio.js", async () => {
  const fs = await import("node:fs/promises");
  return {
    combineVideoWithVoiceOver: vi.fn(async (_videoPath: string, _audioPath: string, outputPath: string) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, "fake-mp4", "utf8");
    }),
    writeWav24kMono: vi.fn(async (_data: Buffer, _mimeType: string, outputPath: string) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, "fake-wav", "utf8");
    })
  };
});

function buildCacheKey(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

describe("job processor", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();
  const settingsStore = new SettingsStore();

  beforeEach(async () => {
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
  });

  it("writes only mp4 and caption outputs to outputs/platform", async () => {
    const jobId = "job-processor-1";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");

    const job: JobRecord = {
      jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Sabun Jerawat",
      description: "Sabun pembersih wajah untuk bantu kulit berminyak.",
      affiliateLink: "https://contoh-affiliate.test/sabun",
      videoPath,
      videoMimeType: "video/mp4",
      videoDurationSec: 18,
      overallStatus: "queued",
      platforms: PLATFORM_ORDER.map((platformId) => ({
        platformId,
        status: "pending",
        artifactPaths: [],
        updatedAt: new Date().toISOString()
      }))
    };
    await jobsStore.create(job);

    const aiService = {
      uploadVideo: vi.fn(async () => ({
        fileId: "mock-video",
        filename: "source.mp4",
        mimeType: "video/mp4"
      })),
      generateScript: vi.fn(async () => "Ini script untuk sabun jerawat yang singkat dan jelas."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption sabun jerawat.",
        hashtags: ["#affiliate", "#sabunjerawat"]
      }))
    };
    const speechGenerator = {
      generateSpeech: vi.fn(async () => ({
        data: Buffer.from("audio"),
        mimeType: "audio/wav"
      }))
    };

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      aiService as never,
      speechGenerator,
      logger
    );

    processor.enqueue(jobId, ["tiktok"]);
    await processor.whenIdle();

    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    expect(tiktok?.status).toBe("done");
    expect(tiktok?.mp4Path).toBe("/outputs/tiktok/sabun-jerawat.mp4");
    expect(tiktok?.captionPath).toBe("/outputs/tiktok/sabun-jerawat-caption.txt");
    expect(tiktok?.scriptPath).toBeUndefined();
    expect(tiktok?.srtPath).toBeUndefined();
    expect(tiktok?.artifactPaths).toEqual([
      "/outputs/tiktok/sabun-jerawat.mp4",
      "/outputs/tiktok/sabun-jerawat-caption.txt"
    ]);
    expect(updated?.overallStatus).toBe("queued");

    const mp4File = outputUrlToAbsolutePath(tiktok?.mp4Path || "");
    const captionFile = outputUrlToAbsolutePath(tiktok?.captionPath || "");
    expect(mp4File).toBe(path.join(OUTPUTS_DIR, "tiktok", "sabun-jerawat.mp4"));
    expect(captionFile).toBe(path.join(OUTPUTS_DIR, "tiktok", "sabun-jerawat-caption.txt"));
    expect(await readFile(captionFile!, "utf8")).toContain("Caption sabun jerawat.");
  });

  it("reuses cached model outputs on retry when inputs have not changed", async () => {
    const jobId = "job-processor-cache";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    const cachedAudioPath = path.join(uploadDir, "tiktok-tts.wav");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    await writeFile(cachedAudioPath, "cached-wav", "utf8");

    const title = "Sabun Jerawat";
    const description = "Sabun pembersih wajah untuk bantu kulit berminyak.";
    const scriptText = "Ini script retry yang sudah pernah berhasil dibuat sebelumnya.";
    const captionText = "Caption retry yang dipakai ulang.";
    const hashtags = ["#affiliate", "#sabunjerawat"];
    const ctaText = "klik keranjang kuning buat cek harga dan variannya";
    const tiktokSettings = DEFAULT_SETTINGS.platforms.find((platform) => platform.platformId === "tiktok");

    const scriptPrompt = buildScriptPrompt({
      settings: DEFAULT_SETTINGS,
      platformId: "tiktok",
      title,
      description,
      videoDurationSec: 18,
      ctaText
    });
    const captionPrompt = buildReelsMetadataPrompt({
      title,
      description,
      platformId: "tiktok",
      scriptText,
      ctaText
    });

    const job: JobRecord = {
      jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title,
      description,
      affiliateLink: "https://contoh-affiliate.test/sabun",
      videoPath,
      videoMimeType: "video/mp4",
      videoDurationSec: 18,
      overallStatus: "failed",
      platforms: PLATFORM_ORDER.map((platformId) =>
        platformId === "tiktok"
          ? {
              platformId,
              status: "failed",
              errorMessage: "mock fail",
              retryAfter: new Date(Date.now() - 1000).toISOString(),
              captionText,
              hashtags,
              scriptText,
              selectedCtaText: ctaText,
              selectedCtaIndex: 1,
              scriptCacheKey: buildCacheKey({
                stage: "script",
                model: DEFAULT_SETTINGS.scriptModel,
                prompt: scriptPrompt
              }),
              captionCacheKey: buildCacheKey({
                stage: "caption",
                model: DEFAULT_SETTINGS.scriptModel,
                prompt: captionPrompt
              }),
              ttsCacheKey: buildCacheKey({
                stage: "tts",
                model: DEFAULT_SETTINGS.ttsModel,
                text: scriptText,
                voiceName: tiktokSettings?.voiceName,
                speechRate: tiktokSettings?.speechRate
              }),
              artifactPaths: [],
              updatedAt: new Date().toISOString()
            }
          : {
              platformId,
              status: "pending",
              artifactPaths: [],
              updatedAt: new Date().toISOString()
            }
      )
    };
    await jobsStore.create(job);

    const aiService = {
      uploadVideo: vi.fn(async () => ({
        fileId: "mock-video",
        filename: "source.mp4",
        mimeType: "video/mp4"
      })),
      generateScript: vi.fn(async () => scriptText),
      generateSocialMetadata: vi.fn(async () => ({
        caption: captionText,
        hashtags
      }))
    };
    const speechGenerator = {
      generateSpeech: vi.fn(async () => ({
        data: Buffer.from("audio"),
        mimeType: "audio/wav"
      }))
    };

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      aiService as never,
      speechGenerator,
      logger
    );

    processor.enqueue(jobId, ["tiktok"]);
    await processor.whenIdle();

    expect(aiService.uploadVideo).not.toHaveBeenCalled();
    expect(aiService.generateScript).not.toHaveBeenCalled();
    expect(aiService.generateSocialMetadata).not.toHaveBeenCalled();
    expect(speechGenerator.generateSpeech).not.toHaveBeenCalled();

    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    expect(tiktok?.status).toBe("done");
    expect(tiktok?.captionText).toBe(captionText);
    expect(tiktok?.mp4Path).toBe("/outputs/tiktok/sabun-jerawat.mp4");
  });
});
