import type { FastifyBaseLogger } from "fastify";
import type { JobRecord } from "../types.js";
import { AUTO_CANCEL_STALE_JOB_REASON, JobsStore } from "../stores/jobs-store.js";
import type { IJobProcessor } from "./job-processor.js";

const STARTUP_RENDER_CANCEL_REASON =
  "Render tidak dilanjutkan otomatis saat startup. Pilih clip lagi jika ingin render ulang.";

function shouldResumeAnalysis(job: JobRecord): boolean {
  return job.analysisStatus === "pending" || job.analysisStatus === "running";
}

function shouldResumeRender(job: JobRecord): boolean {
  return Boolean(
    job.selectedClipId &&
      (job.finalRender?.status === "pending" || job.finalRender?.status === "running")
  );
}

export async function resumeIncompleteJobs(
  jobsStore: JobsStore,
  processor: IJobProcessor,
  logger: FastifyBaseLogger
): Promise<number> {
  const jobs = await jobsStore.list();
  const renderJobs = jobs.filter((job) => shouldResumeRender(job));
  for (const renderJob of renderJobs) {
    await jobsStore.update(renderJob.jobId, (current) => ({
      ...current,
      updatedAt: new Date().toISOString(),
      overallStatus: "interrupted",
      finalRender: {
        ...(current.finalRender ?? {
          status: "idle",
          updatedAt: new Date().toISOString()
        }),
        status: "failed",
        errorMessage: STARTUP_RENDER_CANCEL_REASON,
        updatedAt: new Date().toISOString()
      },
      platforms: current.platforms.map((platform) =>
        platform.status === "pending" || platform.status === "running"
          ? {
              ...platform,
              status: "interrupted",
              updatedAt: new Date().toISOString(),
              errorMessage: STARTUP_RENDER_CANCEL_REASON
            }
          : platform
      )
    }));
    logger.info(
      { jobId: renderJob.jobId },
      "Render job tidak di-resume otomatis saat startup."
    );
  }

  const resumableJobs = jobs.filter((job) => shouldResumeAnalysis(job));
  if (resumableJobs.length === 0) {
    return 0;
  }

  const latestJob = [...resumableJobs].sort(
    (a, b) =>
      new Date(b.updatedAt || b.createdAt).getTime() - new Date(a.updatedAt || a.createdAt).getTime()
  )[0]!;
  const suspendedCount = await jobsStore.suspendOtherIncompleteJobs(
    latestJob.jobId,
    AUTO_CANCEL_STALE_JOB_REASON
  );

  processor.enqueueAnalysis(latestJob.jobId, { forceFresh: true });
  logger.info(
    { jobId: latestJob.jobId, suspendedCount },
    "Menjadwalkan ulang analisis job terbaru saat startup."
  );
  return 1;
}
