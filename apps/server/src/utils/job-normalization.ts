import type { JobRecord, PlatformRun } from "../types.js";
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
  return {
    ...job,
    platforms: job.platforms.map((platform) => normalizePlatformRun(platform, job.jobId))
  };
}
