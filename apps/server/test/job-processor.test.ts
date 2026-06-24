import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { JobProcessor } from "../src/services/job-processor.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import type { JobRecord } from "../src/types.js";
import { OUTPUTS_DIR, UPLOADS_DIR } from "../src/utils/paths.js";
import { renderPlatformVideo } from "../src/utils/render-video.js";
import {
  createVideoPreview,
  detectSceneChangeTimestamps,
  extractAnalysisFramesForRange
} from "../src/utils/video.js";
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
    renderPlatformVideo: vi.fn(async (input: { outputVideoPath: string }) => {
      await fs.mkdir(path.dirname(input.outputVideoPath), { recursive: true });
      await fs.writeFile(input.outputVideoPath, "fake-mp4", "utf8");
      return {
        renderProfileId: "youtube_editorial",
        renderProfileLabel: "YouTube Editorial",
        variantKey: "editorial_center",
        burnSubtitles: true,
        filterComplex: "setpts=PTS-STARTPTS"
      };
    })
  };
});

vi.mock("../src/utils/video.js", async () => {
  const actual = await vi.importActual<typeof import("../src/utils/video.js")>(
    "../src/utils/video.js"
  );
  const fs = await import("node:fs/promises");
  return {
    ...actual,
    detectSceneChangeTimestamps: vi.fn(async () => [22, 40]),
    extractAnalysisFramesForRange: vi.fn(async (_file, startSec, endSec) => [
      {
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        timestampSec: Number((startSec + 1).toFixed(3))
      },
      {
        dataUrl: "data:image/jpeg;base64,ZmFrZQ==",
        timestampSec: Number((endSec - 1).toFixed(3))
      }
    ]),
    createVideoPreview: vi.fn(async (sourcePath, outputPath) => {
      await fs.mkdir(path.dirname(outputPath), { recursive: true });
      await fs.writeFile(outputPath, `preview:${sourcePath}`, "utf8");
    }),
    probeVideoMetadata: vi.fn(async () => ({
      durationSec: 60,
      width: 1080,
      height: 1920,
      rotation: 0,
      displayWidth: 1080,
      displayHeight: 1920
    }))
  };
});

describe("job processor", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();
  const settingsStore = new SettingsStore();

  beforeEach(async () => {
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
    vi.mocked(detectSceneChangeTimestamps).mockClear();
    vi.mocked(extractAnalysisFramesForRange).mockClear();
    vi.mocked(createVideoPreview).mockClear();
    vi.mocked(renderPlatformVideo).mockClear();
  });

  async function createJob(jobId: string): Promise<JobRecord> {
    const uploadDir = path.join(UPLOADS_DIR, jobId);
    const videoPath = path.join(uploadDir, "source.mp4");
    await mkdir(uploadDir, { recursive: true });
    await writeFile(videoPath, "fake-video", "utf8");

    const job: JobRecord = {
      jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Blender Portable",
      description: "Video demo blender portable untuk jus dan smoothie.",
      affiliateLink: "https://contoh-affiliate.test/blender",
      videoPath,
      videoMimeType: "video/mp4",
      videoDurationSec: 60,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "pending",
      clipCandidates: [],
      finalRender: {
        status: "idle",
        updatedAt: new Date().toISOString()
      },
      platforms: [
        {
          platformId: "youtube",
          status: "pending",
          artifactPaths: [],
          updatedAt: new Date().toISOString()
        }
      ]
    };
    await jobsStore.create(job);
    return job;
  }

  it("analyzes video and stores three shortlisted clip candidates", async () => {
    await createJob("job-analysis");

    const aiService = {
      analyzeClipCandidates: vi.fn(async ({ candidates }) =>
        candidates.map((candidate, index) => ({
          clipId: candidate.clipId,
          startSec: candidate.startSec,
          endSec: candidate.endSec,
          durationSec: candidate.durationSec,
          frameTimestamps: candidate.frameTimestamps,
          score: 9 - index * 0.6,
          reason: `Kandidat ${candidate.clipId} punya demo visual kuat.`
        }))
      ),
      generateScript: vi.fn(),
      generateSocialMetadata: vi.fn()
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

    processor.enqueueAnalysis("job-analysis", { forceFresh: true });
    await processor.whenIdle();

    const updated = await jobsStore.getById("job-analysis");
    expect(updated?.analysisStatus).toBe("done");
    expect(updated?.clipCandidates).toHaveLength(3);
    expect(updated?.clipCandidates?.every((candidate) => candidate.previewPath?.includes("/outputs/youtube/previews/"))).toBe(true);
    expect(updated?.overallStatus).toBe("queued");
    expect(aiService.analyzeClipCandidates).toHaveBeenCalledTimes(1);
    expect(vi.mocked(createVideoPreview)).toHaveBeenCalled();
  });

  it("renders the selected clip into final youtube outputs", async () => {
    const created = await createJob("job-render");
    await jobsStore.update(created.jobId, (job) => ({
      ...job,
      analysisStatus: "done",
      selectedClipId: "clip_1",
      clipCandidates: [
        {
          clipId: "clip_1",
          startSec: 4,
          endSec: 28,
          durationSec: 24,
          score: 8.9,
          reason: "Hook visual kuat.",
          previewPath: "/outputs/youtube/previews/job-render-clip_1.mp4",
          frameTimestamps: [5, 16, 27]
        }
      ],
      finalRender: {
        status: "pending",
        updatedAt: new Date().toISOString()
      }
    }));

    const aiService = {
      analyzeClipCandidates: vi.fn(),
      generateScript: vi.fn(async () => "Hook cepat, manfaat jelas, lalu CTA ke deskripsi."),
      generateSocialMetadata: vi.fn(async () => ({
        caption: "Caption blender portable.",
        hashtags: ["#shorts", "#affiliate"]
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

    processor.enqueueRender("job-render", { forceFresh: true });
    await processor.whenIdle();

    const updated = await jobsStore.getById("job-render");
    expect(updated?.overallStatus).toBe("success");
    expect(updated?.finalRender?.status).toBe("done");
    expect(updated?.finalRender?.mp4Path).toContain("/outputs/youtube/");
    expect(updated?.finalRender?.captionText).toBe("Caption blender portable.");
    expect(renderPlatformVideo).toHaveBeenCalledTimes(1);

    const captionFile = path.join(OUTPUTS_DIR, "youtube", path.basename(updated?.finalRender?.captionPath || ""));
    expect(await readFile(captionFile, "utf8")).toContain("Caption blender portable.");
    expect(await readFile(captionFile, "utf8")).toContain("#shorts #affiliate");
  });
});
