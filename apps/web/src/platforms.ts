import type { AppSettings, PlatformId } from "./types";

export const PLATFORM_ORDER: PlatformId[] = ["tiktok", "youtube", "facebook", "shopee"];

export const PLATFORM_LABEL: Record<PlatformId, string> = {
  tiktok: "TikTok",
  youtube: "YouTube Shorts",
  facebook: "Facebook",
  shopee: "Shopee"
};

export function normalizePlatformIds(platformIds: PlatformId[]): PlatformId[] {
  const selected = new Set(platformIds);
  return PLATFORM_ORDER.filter((platformId) => selected.has(platformId));
}

export function getEnabledPlatformIds(settings: Pick<AppSettings, "platforms">): PlatformId[] {
  return normalizePlatformIds(
    settings.platforms.filter((platform) => platform.enabled).map((platform) => platform.platformId)
  );
}
