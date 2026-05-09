import { readdir, rm } from "node:fs/promises";
import path from "node:path";
import { MAX_HISTORY } from "../constants.js";
import type { JobOverallStatus, JobRecord, PlatformRun, PlatformStatus } from "../types.js";
import { JsonFile } from "../utils/json-file.js";
import { normalizeJobRecord } from "../utils/job-normalization.js";
import { JOBS_FILE, UPLOADS_DIR, outputUrlToAbsolutePath } from "../utils/paths.js";

function nowIso(): string {
  return new Date().toISOString();
}

function listOutputArtifacts(job: JobRecord): string[] {
  const files = new Set<string>();
  for (const platform of job.platforms) {
    for (const output of [
      ...(platform.artifactPaths || []),
      platform.scriptPath,
      platform.srtPath,
      platform.mp4Path,
      platform.captionPath
    ]) {
      if (!output) {
        continue;
      }
      const absolutePath = outputUrlToAbsolutePath(output);
      if (absolutePath) {
        files.add(absolutePath);
      }
    }
  }
  return [...files];
}

function listOutputDirectories(job: JobRecord): string[] {
  const directories = new Set<string>();
  for (const filePath of listOutputArtifacts(job)) {
    directories.add(path.dirname(filePath));
  }
  return [...directories];
}

export class JobsStore {
  private readonly file = new JsonFile<JobRecord[]>(JOBS_FILE, []);

  public async list(): Promise<JobRecord[]> {
    const jobs = await this.file.get();
    return jobs.map(normalizeJobRecord);
  }

  public async getById(jobId: string): Promise<JobRecord | undefined> {
    const jobs = await this.file.get();
    const job = jobs.find((item) => item.jobId === jobId);
    return job ? normalizeJobRecord(job) : undefined;
  }

  public async create(job: JobRecord): Promise<JobRecord> {
    const normalizedJob = normalizeJobRecord(job);
    await this.file.update(async (jobs) => {
      const next = [normalizedJob, ...jobs.map(normalizeJobRecord)];
      const removed = next.slice(MAX_HISTORY);
      const kept = next.slice(0, MAX_HISTORY);
      await Promise.all(removed.map((item) => this.cleanupJobArtifacts(item)));
      return kept;
    });
    return normalizedJob;
  }

  public async update(
    jobId: string,
    updater: (job: JobRecord) => JobRecord
  ): Promise<JobRecord | undefined> {
    let updated: JobRecord | undefined;
    await this.file.update((jobs) => {
      const next = [...jobs];
      const index = next.findIndex((job) => job.jobId === jobId);
      if (index < 0) {
        return jobs;
      }
      const currentRaw = next[index];
      if (!currentRaw) {
        return jobs;
      }
      const current = normalizeJobRecord(currentRaw);
      updated = updater({
        ...current,
        platforms: current.platforms.map((platform) => ({
          ...platform,
          artifactPaths: [...platform.artifactPaths]
        }))
      });
      if (updated) {
        next[index] = normalizeJobRecord(updated);
        updated = next[index];
      }
      return next;
    });
    return updated;
  }

  public async delete(jobId: string): Promise<boolean> {
    let removed: JobRecord | undefined;
    await this.file.update((jobs) => {
      const next = jobs.filter((job) => {
        if (job.jobId === jobId) {
          removed = job;
          return false;
        }
        return true;
      });
      return next;
    });

    if (removed) {
      await this.cleanupJobArtifacts(removed);
      return true;
    }

    return false;
  }

  public async markRunningAsInterrupted(): Promise<void> {
    await this.file.update((jobs) =>
      jobs.map((rawJob) => {
        const job = normalizeJobRecord(rawJob);
        if (job.overallStatus !== "running") {
          return job;
        }
        return {
          ...job,
          updatedAt: nowIso(),
          overallStatus: "interrupted",
          platforms: job.platforms.map((platform) =>
            platform.status === "running"
              ? {
                  ...platform,
                  status: "interrupted",
                  updatedAt: nowIso(),
                  errorMessage: "Server restart saat job berjalan."
                }
              : platform
          )
        };
      })
    );
  }

  public async normalizeAll(): Promise<void> {
    await this.file.update((jobs) => jobs.map(normalizeJobRecord));
  }

  public static computeOverallStatus(platforms: PlatformRun[]): JobOverallStatus {
    const done = platforms.filter((platform) => platform.status === "done").length;
    const failed = platforms.filter((platform) => platform.status === "failed").length;
    const interrupted = platforms.filter((platform) => platform.status === "interrupted").length;
    const running = platforms.filter((platform) => platform.status === "running").length;
    const pending = platforms.filter((platform) => platform.status === "pending").length;

    if (running > 0) {
      return "running";
    }
    if (pending > 0) {
      return "queued";
    }
    if (done > 0 && failed === 0 && interrupted === 0) {
      return "success";
    }
    if (done > 0 && (failed > 0 || interrupted > 0)) {
      return "partial_success";
    }
    if (done === 0 && interrupted > 0 && failed === 0) {
      return "interrupted";
    }
    return "failed";
  }

  public static setPlatformStatus(
    platforms: PlatformRun[],
    platformId: PlatformRun["platformId"],
    status: PlatformStatus,
    message?: string
  ): PlatformRun[] {
    return platforms.map((platform) => {
      if (platform.platformId !== platformId) {
        return platform;
      }
      return {
        ...platform,
        status,
        updatedAt: nowIso(),
        errorMessage: message
      };
    });
  }

  private async cleanupJobArtifacts(job: JobRecord): Promise<void> {
    await Promise.all(
      listOutputArtifacts(job).map((filePath) => rm(filePath, { recursive: false, force: true }))
    );

    await rm(path.join(UPLOADS_DIR, job.jobId), { recursive: true, force: true });

    for (const directory of listOutputDirectories(job)) {
      try {
        const entries = await readdir(directory);
        if (entries.length === 0) {
          await rm(directory, { recursive: false, force: true });
        }
      } catch {
        // Ignore cleanup errors for empty folder removal.
      }
    }
  }
}
