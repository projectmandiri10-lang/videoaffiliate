import type { FastifyBaseLogger } from "fastify";
import type { JobRecord, JobOverallStatus, PlatformId, PlatformStatus } from "../types.js";
import { JobsStore } from "../stores/jobs-store.js";
import type { IJobProcessor } from "./job-processor.js";

const RESUMABLE_JOB_STATUSES = new Set<JobOverallStatus>(["queued", "interrupted"]);
const RESUMABLE_PLATFORM_STATUSES = new Set<PlatformStatus>(["pending", "interrupted"]);

export function getResumablePlatformIds(job: JobRecord): PlatformId[] {
  if (!RESUMABLE_JOB_STATUSES.has(job.overallStatus)) {
    return [];
  }

  return job.platforms
    .filter((platform) => RESUMABLE_PLATFORM_STATUSES.has(platform.status))
    .map((platform) => platform.platformId);
}

export async function resumeIncompleteJobs(
  jobsStore: JobsStore,
  processor: IJobProcessor,
  logger: FastifyBaseLogger
): Promise<number> {
  const jobs = await jobsStore.list();
  let resumedCount = 0;

  for (const job of jobs) {
    const platformIds = getResumablePlatformIds(job);
    if (platformIds.length === 0) {
      continue;
    }

    processor.enqueue(job.jobId, platformIds);
    resumedCount += 1;
    logger.info(
      { jobId: job.jobId, platformIds },
      "Menjadwalkan ulang job yang belum selesai saat startup."
    );
  }

  return resumedCount;
}
