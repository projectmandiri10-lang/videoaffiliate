import { access, readdir } from "node:fs/promises";
import path from "node:path";
import mime from "mime-types";
import type { JobRecord } from "../types.js";
import { UPLOADS_DIR } from "./paths.js";

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isSourceCandidate(filename: string): boolean {
  return /^source(?:\.[^.]+)?$/i.test(filename);
}

export function guessVideoMimeType(filePath: string, fallback = "video/mp4"): string {
  const detected = mime.lookup(path.extname(filePath));
  return typeof detected === "string" ? detected : fallback;
}

export async function findFallbackSourcePath(jobId: string): Promise<string | undefined> {
  const uploadDir = path.join(UPLOADS_DIR, jobId);
  let entries: string[];
  try {
    entries = await readdir(uploadDir);
  } catch {
    return undefined;
  }

  const candidates = entries
    .filter(isSourceCandidate)
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: "base" }));

  for (const candidate of candidates) {
    const candidatePath = path.join(uploadDir, candidate);
    if (await fileExists(candidatePath)) {
      return candidatePath;
    }
  }

  return undefined;
}

export async function resolveStoredJobSource(job: Pick<JobRecord, "jobId" | "videoPath" | "videoMimeType">): Promise<{
  videoPath: string;
  videoMimeType: string;
  healed: boolean;
} | null> {
  if (job.videoPath && (await fileExists(job.videoPath))) {
    return {
      videoPath: job.videoPath,
      videoMimeType: guessVideoMimeType(job.videoPath, job.videoMimeType || "video/mp4"),
      healed: false
    };
  }

  const fallbackPath = await findFallbackSourcePath(job.jobId);
  if (!fallbackPath) {
    return null;
  }

  return {
    videoPath: fallbackPath,
    videoMimeType: guessVideoMimeType(fallbackPath, job.videoMimeType || "video/mp4"),
    healed: true
  };
}
