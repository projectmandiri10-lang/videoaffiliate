import type { ClipCandidate, JobRecord, PlatformRun } from "../types.js";
import { getRenderProfileIdForPlatform, pickRenderVariantKey } from "../render-config.js";
import { normalizeSocialMetadata } from "./model-output.js";

function trimOptional(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getEffectivePlatformMetadata(
  job: Pick<JobRecord, "title" | "description" | "affiliateLink">,
  platform?: Pick<PlatformRun, "titleOverride" | "descriptionOverride" | "affiliateLinkOverride">
): {
  title: string;
  description: string;
  affiliateLink: string;
} {
  return {
    title: trimOptional(platform?.titleOverride) ?? job.title,
    description: trimOptional(platform?.descriptionOverride) ?? job.description,
    affiliateLink: trimOptional(platform?.affiliateLinkOverride) ?? job.affiliateLink ?? ""
  };
}

export function normalizePlatformRun(platform: PlatformRun, jobId = "legacy-job"): PlatformRun {
  const hasSocialMetadata = Boolean(platform.captionText?.trim() || platform.hashtags?.length);
  const social = hasSocialMetadata
    ? normalizeSocialMetadata({
        caption: platform.captionText,
        hashtags: platform.hashtags
      })
    : undefined;
  const renderProfileId = platform.renderProfileId ?? getRenderProfileIdForPlatform(platform.platformId);

  return {
    ...platform,
    renderProfileId,
    renderVariantKey:
      trimOptional(platform.renderVariantKey) ??
      pickRenderVariantKey(jobId, platform.platformId, renderProfileId),
    renderCacheKey: trimOptional(platform.renderCacheKey),
    titleOverride: trimOptional(platform.titleOverride),
    descriptionOverride: trimOptional(platform.descriptionOverride),
    affiliateLinkOverride: trimOptional(platform.affiliateLinkOverride),
    captionText: social?.caption || undefined,
    hashtags: social?.hashtags.length ? social.hashtags : undefined,
    artifactPaths: [...(platform.artifactPaths || [])]
  };
}

export function normalizeJobRecord(job: JobRecord): JobRecord {
  const clipCandidates: ClipCandidate[] = Array.isArray(job.clipCandidates)
    ? job.clipCandidates
        .filter((candidate) => candidate && typeof candidate === "object")
        .map((candidate) => ({
          ...candidate,
          previewPath: trimOptional(candidate.previewPath),
          reason: String(candidate.reason || "").trim(),
          frameTimestamps: Array.isArray(candidate.frameTimestamps)
            ? candidate.frameTimestamps.filter((value) => Number.isFinite(value))
            : []
        }))
        .sort((a, b) => b.score - a.score || a.startSec - b.startSec)
    : [];

  return {
    ...job,
    workflow: job.workflow ?? "youtube_shorts",
    analysisStatus: job.analysisStatus ?? (clipCandidates.length > 0 ? "done" : "pending"),
    analysisErrorMessage: trimOptional(job.analysisErrorMessage),
    clipCandidates,
    selectedClipId: trimOptional(job.selectedClipId),
    finalRender: {
      status: job.finalRender?.status ?? "idle",
      errorMessage: trimOptional(job.finalRender?.errorMessage),
      scriptText: trimOptional(job.finalRender?.scriptText),
      captionText: trimOptional(job.finalRender?.captionText),
      hashtags: normalizeSocialMetadata({
        caption: job.finalRender?.captionText,
        hashtags: job.finalRender?.hashtags
      }).hashtags,
      srtPath: trimOptional(job.finalRender?.srtPath),
      mp4Path: trimOptional(job.finalRender?.mp4Path),
      captionPath: trimOptional(job.finalRender?.captionPath),
      updatedAt: job.finalRender?.updatedAt ?? job.updatedAt
    },
    platforms: job.platforms.map((platform) => normalizePlatformRun(platform, job.jobId))
  };
}
