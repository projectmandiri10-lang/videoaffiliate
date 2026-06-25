import type {
  AnalysisStatus,
  ClipCandidate,
  FinalRenderRecord,
  FinalRenderStatus,
  JobOverallStatus,
  JobRecord,
  JobRuntimeState,
  LocalArtifactRef,
  PlatformRun,
  PlatformStatus
} from "./types.js";

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function asNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const cleaned = value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item));
  return cleaned.length ? cleaned : undefined;
}

function asArtifactRef(value: unknown): LocalArtifactRef | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<LocalArtifactRef>;
  const artifactId = asString(candidate.artifactId);
  const fileName = asString(candidate.fileName);
  const mimeType = asString(candidate.mimeType);
  const createdAt = asString(candidate.createdAt);

  if (!artifactId || !fileName || !mimeType || !createdAt) {
    return undefined;
  }

  return {
    artifactId,
    fileName,
    mimeType,
    size: asNumber(candidate.size, 0),
    storage: candidate.storage === "opfs" ? "opfs" : "idb",
    createdAt
  };
}

function normalizePlatformStatus(value: unknown): PlatformStatus {
  return value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "interrupted"
    ? value
    : "pending";
}

function normalizeOverallStatus(value: unknown): JobOverallStatus {
  return value === "running" ||
    value === "success" ||
    value === "partial_success" ||
    value === "failed" ||
    value === "interrupted"
    ? value
    : "queued";
}

function normalizeAnalysisStatus(value: unknown, hasCandidates: boolean): AnalysisStatus {
  if (
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "interrupted"
  ) {
    return value;
  }
  return hasCandidates ? "done" : "pending";
}

function normalizeFinalRenderStatus(value: unknown): FinalRenderStatus {
  return value === "pending" ||
    value === "running" ||
    value === "done" ||
    value === "failed" ||
    value === "interrupted"
    ? value
    : "idle";
}

function normalizeRuntime(value: unknown): JobRuntimeState {
  const candidate = value && typeof value === "object" ? (value as Partial<JobRuntimeState>) : {};
  return {
    deviceMode: candidate.deviceMode === "mobile_restricted" ? "mobile_restricted" : "desktop",
    stage:
      candidate.stage === "validating" ||
      candidate.stage === "preparing" ||
      candidate.stage === "analyzing" ||
      candidate.stage === "selecting_clip" ||
      candidate.stage === "rendering" ||
      candidate.stage === "persisting" ||
      candidate.stage === "done"
        ? candidate.stage
        : "idle",
    progress: Math.max(0, Math.min(1, asNumber(candidate.progress, 0))),
    statusMessage: asString(candidate.statusMessage),
    interruptReason: asString(candidate.interruptReason),
    lastWorkerLog: asString(candidate.lastWorkerLog)
  };
}

function normalizeClipCandidates(value: unknown): ClipCandidate[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const candidate = item as Partial<ClipCandidate>;
      return {
        clipId: asString(candidate.clipId) ?? `clip-${Math.random().toString(36).slice(2, 8)}`,
        startSec: asNumber(candidate.startSec, 0),
        endSec: asNumber(candidate.endSec, 0),
        durationSec: asNumber(candidate.durationSec, 0),
        score: asNumber(candidate.score, 0),
        reason: asString(candidate.reason) ?? "Potongan video ini siap dipakai.",
        previewPath: asArtifactRef(candidate.previewPath),
        frameTimestamps: Array.isArray(candidate.frameTimestamps)
          ? candidate.frameTimestamps.filter(
              (frame): frame is number => typeof frame === "number" && Number.isFinite(frame)
            )
          : []
      };
    })
    .sort((left, right) => right.score - left.score || left.startSec - right.startSec);
}

function normalizeFinalRender(value: unknown, updatedAtFallback: string): FinalRenderRecord {
  const candidate = value && typeof value === "object" ? (value as Partial<FinalRenderRecord>) : {};
  return {
    status: normalizeFinalRenderStatus(candidate.status),
    errorMessage: asString(candidate.errorMessage),
    scriptText: asString(candidate.scriptText),
    captionText: asString(candidate.captionText),
    hashtags: asStringArray(candidate.hashtags),
    srtPath: asArtifactRef(candidate.srtPath),
    mp4Path: asArtifactRef(candidate.mp4Path),
    captionPath: asArtifactRef(candidate.captionPath),
    previewAudioPath: asArtifactRef(candidate.previewAudioPath),
    updatedAt: asString(candidate.updatedAt) ?? updatedAtFallback
  };
}

function normalizePlatforms(value: unknown, updatedAtFallback: string): PlatformRun[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const candidate = item as Partial<PlatformRun>;
      return {
        platformId: "youtube",
        status: normalizePlatformStatus(candidate.status),
        renderProfileId: candidate.renderProfileId,
        artifactPaths: Array.isArray(candidate.artifactPaths)
          ? candidate.artifactPaths
              .map((artifact) => asArtifactRef(artifact))
              .filter((artifact): artifact is LocalArtifactRef => Boolean(artifact))
          : [],
        updatedAt: asString(candidate.updatedAt) ?? updatedAtFallback,
        mp4Path: asArtifactRef(candidate.mp4Path),
        srtPath: asArtifactRef(candidate.srtPath),
        captionPath: asArtifactRef(candidate.captionPath),
        captionText: asString(candidate.captionText),
        hashtags: asStringArray(candidate.hashtags),
        scriptText: asString(candidate.scriptText),
        selectedCtaText: asString(candidate.selectedCtaText),
        selectedCtaIndex:
          typeof candidate.selectedCtaIndex === "number" && Number.isFinite(candidate.selectedCtaIndex)
            ? candidate.selectedCtaIndex
            : undefined
      };
    });
}

export function normalizeBrowserJobRecord(input: unknown): JobRecord | null {
  if (!input || typeof input !== "object") {
    return null;
  }

  const candidate = input as Partial<JobRecord>;
  const createdAt = asString(candidate.createdAt);
  const updatedAt = asString(candidate.updatedAt) ?? createdAt;
  const videoPath = asArtifactRef(candidate.videoPath);
  const title = asString(candidate.title);
  const description = asString(candidate.description);
  const jobId = asString(candidate.jobId);

  if (!createdAt || !updatedAt || !videoPath || !title || !description || !jobId) {
    return null;
  }

  const clipCandidates = normalizeClipCandidates(candidate.clipCandidates);

  return {
    jobId,
    createdAt,
    updatedAt,
    title,
    description,
    affiliateLink: asString(candidate.affiliateLink),
    videoPath,
    videoMimeType: asString(candidate.videoMimeType) ?? videoPath.mimeType,
    videoDurationSec: asNumber(candidate.videoDurationSec, 0),
    overallStatus: normalizeOverallStatus(candidate.overallStatus),
    workflow: "youtube_shorts",
    analysisStatus: normalizeAnalysisStatus(candidate.analysisStatus, clipCandidates.length > 0),
    analysisErrorMessage: asString(candidate.analysisErrorMessage),
    clipCandidates,
    selectedClipId: asString(candidate.selectedClipId),
    finalRender: normalizeFinalRender(candidate.finalRender, updatedAt),
    platforms: normalizePlatforms(candidate.platforms, updatedAt),
    runtime: normalizeRuntime(candidate.runtime)
  };
}
