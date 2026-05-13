import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, PLATFORM_ORDER } from "../src/constants.js";
import {
  RENDERER_VERSION,
  getRenderProfileIdForPlatform,
  pickRenderVariantKey
} from "../src/render-config.js";
import { JobProcessor } from "../src/services/job-processor.js";
import { buildReelsMetadataPrompt, buildScriptPrompt } from "../src/services/prompt-builder.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import type { JobRecord } from "../src/types.js";
import { OUTPUTS_DIR, UPLOADS_DIR, outputUrlToAbsolutePath } from "../src/utils/paths.js";
import { renderPlatformVideo } from "../src/utils/render-video.js";
import { extractAnalysisFrames } from "../src/utils/video.js";
import { compareVideoVisualDifference } from "../src/utils/visual-audit.js";
import { resetTestStorage } from "./helpers.js";

vi.mock("../src/utils/audio.js", async () => {
  const fs = await import("node:fs/promises");
  return {
    writeWav24kMono: vi.fn(async (_data: Buffer, _mimeType: string, outputPath: string) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, "fake-wav", "utf8");
    })
  };
});

vi.mock("../src/utils/render-video.js", async () => {
  const fs = await import("node:fs/promises");
  return {
    buildRenderGraph: vi.fn(),
    renderPlatformVideo: vi.fn(async (input: { outputVideoPath: string; renderProfileId: string; renderVariantKey?: string }) => {
      await fs.mkdir(path.dirname(input.outputVideoPath), { recursive: true });
      await fs.writeFile(input.outputVideoPath, "fake-mp4", "utf8");
      return {
        renderProfileId: input.renderProfileId,
        renderProfileLabel: input.renderProfileId,
        variantKey: input.renderVariantKey ?? "native_base",
        burnSubtitles: input.renderProfileId !== "native_source",
        filterComplex: "setpts=PTS-STARTPTS"
      };
    })
  };
});

vi.mock("../src/utils/video.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/video.js")>(
    "../src/utils/video.js"
  );
  return {
    ...actual,
    extractAnalysisFrames: vi.fn(async () => [
      {
        dataUrl: "https://contoh.test/frame-01.jpg",
        timestampSec: 2.7
      }
    ]),
    probeVideoMetadata: vi.fn(async () => ({
      durationSec: 18,
      width: 1080,
      height: 1920,
      rotation: 0,
      displayWidth: 1080,
      displayHeight: 1920
    }))
  };
});

vi.mock("../src/utils/visual-audit.js", async () => ({
  compareVideoVisualDifference: vi.fn(async () => ({
    score: 8,
    comparedBytes: 4096
  }))
}));

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
    vi.mocked(extractAnalysisFrames).mockClear();
    vi.mocked(renderPlatformVideo).mockClear();
    vi.mocked(compareVideoVisualDifference).mockClear();
    vi.mocked(compareVideoVisualDifference).mockResolvedValue({
      score: 8,
      comparedBytes: 4096
    });
  });

  it("writes mp4 and caption outputs while cleaning temp subtitle artifacts", async () => {
    const jobId = "job-processor-1";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    const tempSrtPath = path.join(uploadDir, "tiktok-render-subtitles.srt");
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
    expect(tiktok?.srtPath).toBeUndefined();
    expect(tiktok?.captionPath).toBe("/outputs/tiktok/sabun-jerawat-caption.txt");
    expect(tiktok?.scriptPath).toBeUndefined();
    expect(tiktok?.renderProfileId).toBe("native_source");
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
    expect(renderPlatformVideo).toHaveBeenCalledTimes(1);
    expect(renderPlatformVideo).toHaveBeenCalledWith(
      expect.objectContaining({
        subtitlePath: tempSrtPath
      })
    );
    await expect(readFile(tempSrtPath, "utf8")).rejects.toThrow();
  });

  it("boosts a non-TikTok render once when visual audit is too similar", async () => {
    const jobId = "job-processor-visual-boost";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    vi.mocked(compareVideoVisualDifference)
      .mockResolvedValueOnce({ score: 1.2, comparedBytes: 4096 })
      .mockResolvedValueOnce({ score: 7.5, comparedBytes: 4096 });

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
      generateScript: vi.fn(async () => "Ini script audit visual yang cukup jelas untuk video."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption audit.",
        hashtags: ["#affiliate"]
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

    processor.enqueue(jobId, ["tiktok", "youtube"]);
    await processor.whenIdle();

    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    const youtube = updated?.platforms.find((platform) => platform.platformId === "youtube");
    expect(tiktok?.visualAuditStatus).toBe("skipped");
    expect(youtube?.status).toBe("done");
    expect(youtube?.visualAuditStatus).toBe("boosted");
    expect(youtube?.visualAuditBoosted).toBe(true);
    expect(youtube?.visualAuditScore).toBe(7.5);
    expect(compareVideoVisualDifference).toHaveBeenCalledTimes(2);
    const youtubeRenderCalls = vi
      .mocked(renderPlatformVideo)
      .mock.calls.map(([input]) => input)
      .filter((input) => input.renderProfileId === "youtube_editorial");
    expect(youtubeRenderCalls).toHaveLength(2);
    expect(youtubeRenderCalls[0]).toEqual(expect.objectContaining({ auditBoost: false }));
    expect(youtubeRenderCalls[1]).toEqual(expect.objectContaining({ auditBoost: true }));
  });

  it("auto-heals legacy source path before processing queued platform", async () => {
    const jobId = "job-processor-heal-source";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const healedVideoPath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(healedVideoPath, "fake-video", "utf8");

    const job: JobRecord = {
      jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Produk Legacy",
      description: "Job lama dengan path source dari mesin sebelumnya.",
      affiliateLink: "https://contoh-affiliate.test/legacy-source",
      videoPath: `C:\\Users\\LENOVO\\Documents\\POS\\VIDEO AFFILIATE\\uploads\\${jobId}\\source.mp4`,
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
      generateScript: vi.fn(async () => "Script healed source."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption healed source.",
        hashtags: ["#heal"]
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
    expect(updated?.videoPath).toBe(healedVideoPath);
    expect(vi.mocked(extractAnalysisFrames)).toHaveBeenCalledWith(healedVideoPath, 18);
    expect(updated?.platforms.find((platform) => platform.platformId === "tiktok")?.status).toBe(
      "done"
    );
  });

  it("fails a non-TikTok platform when boosted render still fails visual audit", async () => {
    const jobId = "job-processor-visual-fail";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    vi.mocked(compareVideoVisualDifference)
      .mockResolvedValueOnce({ score: 1.1, comparedBytes: 4096 })
      .mockResolvedValueOnce({ score: 1.5, comparedBytes: 4096 });

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
      generateScript: vi.fn(async () => "Ini script audit visual yang tetap mirip."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption audit gagal.",
        hashtags: ["#affiliate"]
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

    processor.enqueue(jobId, ["tiktok", "youtube"]);
    await processor.whenIdle();

    const updated = await jobsStore.getById(jobId);
    const youtube = updated?.platforms.find((platform) => platform.platformId === "youtube");
    expect(youtube?.status).toBe("failed");
    expect(youtube?.visualAuditStatus).toBe("failed");
    expect(youtube?.visualAuditBoosted).toBe(true);
    expect(youtube?.visualAuditScore).toBe(1.5);
    expect(youtube?.errorMessage).toContain("Audit visual gagal");
    expect(compareVideoVisualDifference).toHaveBeenCalledTimes(2);
  });

  it("reuses cached model outputs on retry and cleans legacy srt artifacts", async () => {
    const jobId = "job-processor-cache";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    const cachedAudioPath = path.join(uploadDir, "tiktok-tts.wav");
    const outputDir = path.join(OUTPUTS_DIR, "tiktok");
    const mp4OutputPath = path.join(outputDir, "sabun-jerawat.mp4");
    const srtOutputPath = path.join(outputDir, "sabun-jerawat.srt");
    const captionOutputPath = path.join(outputDir, "sabun-jerawat-caption.txt");
    await mkdir(uploadDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    await writeFile(cachedAudioPath, "cached-wav", "utf8");
    await writeFile(mp4OutputPath, "cached-mp4", "utf8");
    await writeFile(srtOutputPath, "cached-srt", "utf8");
    await writeFile(captionOutputPath, "cached-caption", "utf8");

    const title = "Sabun Jerawat";
    const description = "Sabun pembersih wajah untuk bantu kulit berminyak.";
    const scriptText = "Ini script retry yang sudah pernah berhasil dibuat sebelumnya.";
    const captionText = "Caption retry yang dipakai ulang.";
    const hashtags = ["#affiliate", "#sabunjerawat"];
    const ctaText = "klik keranjang kuning buat cek harga dan variannya";
    const tiktokSettings = DEFAULT_SETTINGS.platforms.find((platform) => platform.platformId === "tiktok");
    const renderProfileId = getRenderProfileIdForPlatform("tiktok");
    const renderVariantKey = pickRenderVariantKey(jobId, "tiktok", renderProfileId);

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
    const renderCacheKey = buildCacheKey({
      stage: "render",
      sourceVideoPath: videoPath,
      sourceDurationSec: 18,
      sourceWidth: 1080,
      sourceHeight: 1920,
      sourceRotation: 0,
      scriptText,
      title,
      description,
      ctaText,
      renderProfileId,
      renderVariantKey,
      auditBoost: false,
      rendererVersion: RENDERER_VERSION
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
              renderProfileId,
              renderVariantKey,
              renderCacheKey,
              mp4Path: "/outputs/tiktok/sabun-jerawat.mp4",
              srtPath: "/outputs/tiktok/sabun-jerawat.srt",
              captionPath: "/outputs/tiktok/sabun-jerawat-caption.txt",
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
              artifactPaths: [
                "/outputs/tiktok/sabun-jerawat.mp4",
                "/outputs/tiktok/sabun-jerawat.srt",
                "/outputs/tiktok/sabun-jerawat-caption.txt"
              ],
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

    expect(vi.mocked(extractAnalysisFrames)).not.toHaveBeenCalled();
    expect(aiService.generateScript).not.toHaveBeenCalled();
    expect(aiService.generateSocialMetadata).not.toHaveBeenCalled();
    expect(speechGenerator.generateSpeech).not.toHaveBeenCalled();
    expect(renderPlatformVideo).not.toHaveBeenCalled();

    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    expect(tiktok?.status).toBe("done");
    expect(tiktok?.captionText).toBe(captionText);
    expect(tiktok?.mp4Path).toBe("/outputs/tiktok/sabun-jerawat.mp4");
    expect(tiktok?.srtPath).toBeUndefined();
    expect(tiktok?.artifactPaths).toEqual([
      "/outputs/tiktok/sabun-jerawat.mp4",
      "/outputs/tiktok/sabun-jerawat-caption.txt"
    ]);
    await expect(readFile(srtOutputPath, "utf8")).rejects.toThrow();
  });

  it("regenerates caption only and rewrites caption artifact", async () => {
    const jobId = "job-processor-caption-retry";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    const outputDir = path.join(OUTPUTS_DIR, "tiktok");
    const captionPath = path.join(outputDir, "sabun-jerawat-caption.txt");
    await mkdir(uploadDir, { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    await writeFile(captionPath, "caption lama\n", "utf8");

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
      overallStatus: "success",
      platforms: PLATFORM_ORDER.map((platformId) =>
        platformId === "tiktok"
          ? {
              platformId,
              status: "done",
              scriptText: "Ini script retry caption yang sudah tersedia.",
              selectedCtaText: "klik keranjang kuning buat cek harga dan variannya",
              selectedCtaIndex: 1,
              mp4Path: "/outputs/tiktok/sabun-jerawat.mp4",
              srtPath: "/outputs/tiktok/sabun-jerawat.srt",
              captionPath: "/outputs/tiktok/sabun-jerawat-caption.txt",
              captionText: "Caption lama.",
              hashtags: ["#lama"],
              artifactPaths: [
                "/outputs/tiktok/sabun-jerawat.mp4",
                "/outputs/tiktok/sabun-jerawat.srt",
                "/outputs/tiktok/sabun-jerawat-caption.txt"
              ],
              updatedAt: new Date().toISOString()
            }
          : {
              platformId,
              status: "done",
              artifactPaths: [],
              updatedAt: new Date().toISOString()
            }
      )
    };
    await jobsStore.create(job);

    const aiService = {
      generateScript: vi.fn(),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption baru.",
        hashtags: ["#baru", "#affiliate"]
      }))
    };
    const speechGenerator = {
      generateSpeech: vi.fn()
    };

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      aiService as never,
      speechGenerator as never,
      logger
    );

    const updated = await processor.retryCaption(jobId, "tiktok");
    const tiktok = updated.platforms.find((platform) => platform.platformId === "tiktok");

    expect(vi.mocked(extractAnalysisFrames)).not.toHaveBeenCalled();
    expect(aiService.generateScript).not.toHaveBeenCalled();
    expect(speechGenerator.generateSpeech).not.toHaveBeenCalled();
    expect(renderPlatformVideo).not.toHaveBeenCalled();
    expect(aiService.generateSocialMetadata).toHaveBeenCalledTimes(1);
    expect(tiktok?.captionText).toBe("Caption baru.");
    expect(tiktok?.mp4Path).toBe("/outputs/tiktok/sabun-jerawat.mp4");
    expect(await readFile(captionPath, "utf8")).toContain("Caption baru.");
    expect(await readFile(captionPath, "utf8")).toContain("#baru #affiliate");
  });

  it("bypasses cached outputs when retry job is forced fresh", async () => {
    const jobId = "job-processor-force-fresh";
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    const cachedAudioPath = path.join(uploadDir, "tiktok-tts.wav");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");
    await writeFile(cachedAudioPath, "cached-wav", "utf8");

    const title = "Sabun Jerawat";
    const description = "Sabun pembersih wajah untuk bantu kulit berminyak.";
    const scriptText = "Script lama yang cache-nya valid.";
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
      overallStatus: "success",
      platforms: PLATFORM_ORDER.map((platformId) =>
        platformId === "tiktok"
          ? {
              platformId,
              status: "done",
              captionText: "Caption lama.",
              hashtags: ["#lama"],
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
              status: "done",
              artifactPaths: [],
              updatedAt: new Date().toISOString()
            }
      )
    };
    await jobsStore.create(job);

    const aiService = {
      generateScript: vi.fn(async () => "Script baru force fresh."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption baru force fresh.",
        hashtags: ["#baru"]
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

    processor.enqueue(jobId, ["tiktok"], { forceFresh: true });
    await processor.whenIdle();

    expect(vi.mocked(extractAnalysisFrames)).toHaveBeenCalledTimes(1);
    expect(aiService.generateScript).toHaveBeenCalledTimes(1);
    expect(aiService.generateSocialMetadata).toHaveBeenCalledTimes(1);
    expect(speechGenerator.generateSpeech).toHaveBeenCalledTimes(1);
    expect(renderPlatformVideo).toHaveBeenCalledTimes(1);
    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    expect(tiktok?.captionText).toBe("Caption baru force fresh.");
  });
});
