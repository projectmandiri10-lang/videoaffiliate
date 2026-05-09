import pino from "pino";
import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { beforeEach, describe, expect, it } from "vitest";
import { PLATFORM_ORDER } from "../src/constants.js";
import { resumeIncompleteJobs } from "../src/services/startup-resume.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import type { JobRecord, PlatformId } from "../src/types.js";
import { UPLOADS_DIR } from "../src/utils/paths.js";
import { resetTestStorage } from "./helpers.js";

function buildPlatform(platformId: PlatformId, status: JobRecord["platforms"][number]["status"]) {
  return {
    platformId,
    status,
    artifactPaths: [],
    updatedAt: new Date().toISOString()
  };
}

describe("startup resume", () => {
  const logger = pino({ level: "silent" });
  const jobsStore = new JobsStore();

  beforeEach(async () => {
    await resetTestStorage();
  });

  it("re-enqueues queued jobs for pending platforms only", async () => {
    const job: JobRecord = {
      jobId: "resume-queued-job",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Resume Job",
      description: "Job pending yang harus lanjut saat startup.",
      affiliateLink: "https://contoh-affiliate.test/resume",
      videoPath: "C:\\fake\\resume-queued-job\\source.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 15,
      overallStatus: "queued",
      platforms: [
        buildPlatform("tiktok", "done"),
        buildPlatform("youtube", "done"),
        buildPlatform("facebook", "pending"),
        buildPlatform("shopee", "pending")
      ]
    };
    await jobsStore.create(job);

    const enqueueCalls: Array<{ jobId: string; platformIds?: PlatformId[] }> = [];
    const processor = {
      enqueue(jobId: string, platformIds?: PlatformId[]) {
        enqueueCalls.push({ jobId, platformIds });
      }
    };

    const resumedCount = await resumeIncompleteJobs(jobsStore, processor, logger);

    expect(resumedCount).toBe(1);
    expect(enqueueCalls).toEqual([
      {
        jobId: "resume-queued-job",
        platformIds: ["facebook", "shopee"]
      }
    ]);
  });

  it("re-enqueues interrupted jobs without retrying failed platforms", async () => {
    const job: JobRecord = {
      jobId: "resume-interrupted-job",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Interrupted Job",
      description: "Job interrupted setelah restart server.",
      affiliateLink: "https://contoh-affiliate.test/interrupted",
      videoPath: "C:\\fake\\resume-interrupted-job\\source.mp4",
      videoMimeType: "video/mp4",
      videoDurationSec: 20,
      overallStatus: "interrupted",
      platforms: [
        buildPlatform("tiktok", "done"),
        buildPlatform("youtube", "interrupted"),
        buildPlatform("facebook", "pending"),
        buildPlatform("shopee", "failed")
      ]
    };
    await jobsStore.create(job);

    const enqueueCalls: Array<{ jobId: string; platformIds?: PlatformId[] }> = [];
    const processor = {
      enqueue(jobId: string, platformIds?: PlatformId[]) {
        enqueueCalls.push({ jobId, platformIds });
      }
    };

    const resumedCount = await resumeIncompleteJobs(jobsStore, processor, logger);

    expect(resumedCount).toBe(1);
    expect(enqueueCalls).toEqual([
      {
        jobId: "resume-interrupted-job",
        platformIds: ["youtube", "facebook"]
      }
    ]);
  });

  it("skips jobs that are already final", async () => {
    const now = new Date().toISOString();
    const jobs: JobRecord[] = ["success", "failed"].map((overallStatus, index) => ({
      jobId: `final-job-${index}`,
      createdAt: now,
      updatedAt: now,
      title: `Final Job ${index}`,
      description: "Job final tidak boleh di-resume.",
      affiliateLink: "https://contoh-affiliate.test/final",
      videoPath: `C:\\fake\\final-job-${index}\\source.mp4`,
      videoMimeType: "video/mp4",
      videoDurationSec: 12,
      overallStatus: overallStatus as JobRecord["overallStatus"],
      platforms: PLATFORM_ORDER.map((platformId) => buildPlatform(platformId, "done"))
    }));
    for (const job of jobs) {
      await jobsStore.create(job);
    }

    const enqueueCalls: Array<{ jobId: string; platformIds?: PlatformId[] }> = [];
    const processor = {
      enqueue(jobId: string, platformIds?: PlatformId[]) {
        enqueueCalls.push({ jobId, platformIds });
      }
    };

    const resumedCount = await resumeIncompleteJobs(jobsStore, processor, logger);

    expect(resumedCount).toBe(0);
    expect(enqueueCalls).toEqual([]);
  });

  it("heals legacy source path to local uploads folder before resume", async () => {
    const jobId = "resume-heal-job";
    const healedSourcePath = path.join(UPLOADS_DIR, jobId, "source.mp4");
    await mkdir(path.dirname(healedSourcePath), { recursive: true });
    await writeFile(healedSourcePath, "fake-video", "utf8");

    const job: JobRecord = {
      jobId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      title: "Heal Source Job",
      description: "Job lama dengan videoPath dari laptop lain.",
      affiliateLink: "https://contoh-affiliate.test/heal-source",
      videoPath: `C:\\Users\\LENOVO\\Documents\\POS\\VIDEO AFFILIATE\\uploads\\${jobId}\\source.mp4`,
      videoMimeType: "video/mp4",
      videoDurationSec: 15,
      overallStatus: "queued",
      platforms: [
        buildPlatform("tiktok", "pending"),
        buildPlatform("youtube", "pending"),
        buildPlatform("facebook", "done"),
        buildPlatform("shopee", "done")
      ]
    };
    await jobsStore.create(job);

    const healedCount = await jobsStore.healSourceVideoPaths();
    const enqueueCalls: Array<{ jobId: string; platformIds?: PlatformId[] }> = [];
    const processor = {
      enqueue(nextJobId: string, platformIds?: PlatformId[]) {
        enqueueCalls.push({ jobId: nextJobId, platformIds });
      }
    };

    const resumedCount = await resumeIncompleteJobs(jobsStore, processor, logger);
    const healedJob = await jobsStore.getById(jobId);

    expect(healedCount).toBe(1);
    expect(healedJob?.videoPath).toBe(healedSourcePath);
    expect(resumedCount).toBe(1);
    expect(enqueueCalls).toEqual([
      {
        jobId,
        platformIds: ["tiktok", "youtube"]
      }
    ]);
  });
});
