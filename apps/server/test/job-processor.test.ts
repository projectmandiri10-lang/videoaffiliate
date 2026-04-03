import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, PLATFORM_ORDER } from "../src/constants.js";
import { JobProcessor } from "../src/services/job-processor.js";
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

describe("job processor", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();
  const settingsStore = new SettingsStore();

  beforeEach(async () => {
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
  });

  it("writes latest outputs to outputs/platform and stores script txt path", async () => {
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

    const gemini = {
      uploadVideo: vi.fn(async () => ({
        fileUri: "mock://video",
        mimeType: "video/mp4"
      })),
      generateScript: vi.fn(async () => "Ini script untuk sabun jerawat yang singkat dan jelas."),
      generateSpeech: vi.fn(async () => ({
        data: Buffer.from("audio"),
        mimeType: "audio/wav"
      })),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption sabun jerawat.",
        hashtags: ["#affiliate", "#sabunjerawat"]
      }))
    };

    const processor = new JobProcessor(
      jobsStore,
      settingsStore,
      gemini as never,
      logger
    );

    processor.enqueue(jobId, ["tiktok"]);
    await processor.whenIdle();

    const updated = await jobsStore.getById(jobId);
    const tiktok = updated?.platforms.find((platform) => platform.platformId === "tiktok");
    expect(tiktok?.status).toBe("done");
    expect(tiktok?.scriptPath).toBe("/outputs/tiktok/sabun-jerawat.txt");
    expect(tiktok?.srtPath).toBe("/outputs/tiktok/sabun-jerawat.srt");
    expect(tiktok?.mp4Path).toBe("/outputs/tiktok/sabun-jerawat.mp4");
    expect(tiktok?.artifactPaths).toContain("/outputs/tiktok/sabun-jerawat.txt");
    expect(updated?.overallStatus).toBe("queued");

    const scriptFile = outputUrlToAbsolutePath(tiktok?.scriptPath || "");
    expect(scriptFile).toBe(path.join(OUTPUTS_DIR, "tiktok", "sabun-jerawat.txt"));
    expect(await readFile(scriptFile!, "utf8")).toContain("Ini script untuk sabun jerawat");
  });
});
