import pino from "pino";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resumeIncompleteJobs } from "../src/services/startup-resume.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import type { JobRecord } from "../src/types.js";
import { resetTestStorage } from "./helpers.js";

describe("startup resume", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();

  beforeEach(async () => {
    await resetTestStorage();
  });

  it("re-enqueues pending analysis jobs", async () => {
    const job: JobRecord = {
      jobId: "resume-analysis",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Job Resume",
      description: "Deskripsi resume",
      affiliateLink: "https://contoh.test/a",
      videoPath: "C:/video.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 30,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "pending",
      clipCandidates: [],
      finalRender: {
        status: "idle",
        updatedAt: new Date().toISOString()
      },
      platforms: []
    };
    await jobsStore.create(job);

    const enqueueAnalysis = vi.fn();
    const enqueueRender = vi.fn();
    const resumed = await resumeIncompleteJobs(
      jobsStore,
      {
        enqueueAnalysis,
        enqueueRender,
        whenIdle: async () => {}
      },
      logger
    );

    expect(resumed).toBe(1);
    expect(enqueueAnalysis).toHaveBeenCalledWith("resume-analysis", { forceFresh: true });
    expect(enqueueRender).not.toHaveBeenCalled();
  });

  it("does not auto-resume pending final render jobs on startup", async () => {
    const renderJob: JobRecord = {
      jobId: "resume-render",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Job Render",
      description: "Deskripsi render",
      affiliateLink: "https://contoh.test/b",
      videoPath: "C:/video.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 30,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "done",
      clipCandidates: [
        {
          clipId: "clip_1",
          startSec: 0,
          endSec: 24,
          durationSec: 24,
          score: 8.5,
          reason: "Bagus",
          frameTimestamps: [1, 12, 23]
        }
      ],
      selectedClipId: "clip_1",
      finalRender: {
        status: "pending",
        updatedAt: new Date().toISOString()
      },
      platforms: []
    };
    await jobsStore.create(renderJob);

    const enqueueAnalysis = vi.fn();
    const enqueueRender = vi.fn();
    const resumed = await resumeIncompleteJobs(
      jobsStore,
      {
        enqueueAnalysis,
        enqueueRender,
        whenIdle: async () => {}
      },
      logger
    );

    expect(resumed).toBe(0);
    expect(enqueueRender).not.toHaveBeenCalled();
    expect(enqueueAnalysis).not.toHaveBeenCalled();
    const updated = await jobsStore.getById("resume-render");
    expect(updated?.overallStatus).toBe("interrupted");
    expect(updated?.finalRender?.status).toBe("failed");
    expect(updated?.finalRender?.errorMessage).toContain("startup");
  });

  it("only resumes the newest incomplete job and cancels older ones", async () => {
    const olderJob: JobRecord = {
      jobId: "resume-older",
      createdAt: "2026-06-15T10:00:00.000Z",
      updatedAt: "2026-06-15T10:00:00.000Z",
      title: "Job Lama",
      description: "Deskripsi lama",
      affiliateLink: "https://contoh.test/old",
      videoPath: "C:/old.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 30,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "pending",
      clipCandidates: [],
      finalRender: {
        status: "idle",
        updatedAt: "2026-06-15T10:00:00.000Z"
      },
      platforms: []
    };
    const newestJob: JobRecord = {
      jobId: "resume-newest",
      createdAt: "2026-06-15T10:05:00.000Z",
      updatedAt: "2026-06-15T10:05:00.000Z",
      title: "Job Baru",
      description: "Deskripsi baru",
      affiliateLink: "https://contoh.test/new",
      videoPath: "C:/new.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 30,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "pending",
      clipCandidates: [],
      finalRender: {
        status: "idle",
        updatedAt: "2026-06-15T10:05:00.000Z"
      },
      platforms: []
    };
    await jobsStore.create(olderJob);
    await jobsStore.create(newestJob);

    const enqueueAnalysis = vi.fn();
    const enqueueRender = vi.fn();
    const resumed = await resumeIncompleteJobs(
      jobsStore,
      {
        enqueueAnalysis,
        enqueueRender,
        whenIdle: async () => {}
      },
      logger
    );

    expect(resumed).toBe(1);
    expect(enqueueAnalysis).toHaveBeenCalledTimes(1);
    expect(enqueueAnalysis).toHaveBeenCalledWith("resume-newest", { forceFresh: true });
    expect(enqueueRender).not.toHaveBeenCalled();

    const oldState = await jobsStore.getById("resume-older");
    expect(oldState?.overallStatus).toBe("interrupted");
    expect(oldState?.analysisStatus).toBe("failed");
    expect(oldState?.analysisErrorMessage).toContain("job yang lebih baru");
  });
});
