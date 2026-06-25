import { DEFAULT_SETTINGS, DESKTOP_DEVICE_LIMITS, MOBILE_DEVICE_LIMITS, findTtsVoiceByName } from "./constants.js";
import { normalizeGeminiScriptModel, normalizeGeminiTtsModel } from "./gemini-models.js";
import { PLATFORM_ORDER } from "./platform-config.js";
import type { AppSettings, DeviceLimits, DeviceMode, PlatformId, PlatformSettings } from "./types.js";

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function normalizePlatform(platformId: PlatformId, candidate?: Partial<PlatformSettings>): PlatformSettings {
  const fallback = DEFAULT_SETTINGS.platforms.find((item) => item.platformId === platformId)!;
  let voiceName =
    typeof candidate?.voiceName === "string" && findTtsVoiceByName(candidate.voiceName)
      ? candidate.voiceName
      : fallback.voiceName;
  if (platformId === "youtube" && voiceName === "Charon") {
    voiceName = fallback.voiceName;
  }
  const speechRate =
    typeof candidate?.speechRate === "number"
      ? clamp(candidate.speechRate, 0.7, 1.3)
      : fallback.speechRate;
  return {
    platformId,
    enabled: typeof candidate?.enabled === "boolean" ? candidate.enabled : fallback.enabled,
    voiceName,
    speechRate
  };
}

export function normalizeAppSettings(input: unknown): AppSettings {
  const candidate = input && typeof input === "object" ? (input as Partial<AppSettings>) : {};
  const incomingPlatforms = Array.isArray(candidate.platforms) ? candidate.platforms : [];
  const platformMap = new Map(
    incomingPlatforms
      .filter((item) => {
        return Boolean(item && typeof item.platformId === "string" && PLATFORM_ORDER.includes(item.platformId as PlatformId));
      })
      .map((item) => {
        const platform = item as { platformId: PlatformId } & Partial<PlatformSettings>;
        return [platform.platformId, platform] as const;
      })
  );
  const ctaSequence = {
    ...DEFAULT_SETTINGS.ctaSequence,
    ...(candidate.ctaSequence && typeof candidate.ctaSequence === "object" ? candidate.ctaSequence : {})
  };

  return {
    scriptModel: normalizeGeminiScriptModel(
      typeof candidate.scriptModel === "string" ? candidate.scriptModel : DEFAULT_SETTINGS.scriptModel
    ),
    ttsModel: normalizeGeminiTtsModel(
      typeof candidate.ttsModel === "string" ? candidate.ttsModel : DEFAULT_SETTINGS.ttsModel
    ),
    language: "id-ID",
    maxVideoSeconds: clamp(
      typeof candidate.maxVideoSeconds === "number"
        ? Math.round(candidate.maxVideoSeconds)
        : DEFAULT_SETTINGS.maxVideoSeconds,
      10,
      DESKTOP_DEVICE_LIMITS.maxVideoSeconds
    ),
    safetyMode: "safe_marketing",
    ctaPosition: "end",
    ctaMode: candidate.ctaMode === "sequential" ? "sequential" : "random",
    ctaSequence: {
      tiktok: Math.max(0, Number(ctaSequence.tiktok) || 0),
      youtube: Math.max(0, Number(ctaSequence.youtube) || 0),
      facebook: Math.max(0, Number(ctaSequence.facebook) || 0),
      shopee: Math.max(0, Number(ctaSequence.shopee) || 0)
    },
    concurrency: 1,
    platforms: PLATFORM_ORDER.map((platformId) => normalizePlatform(platformId, platformMap.get(platformId)))
  };
}

export function pickDeviceLimits(mode: DeviceMode): DeviceLimits {
  return mode === "mobile_restricted" ? MOBILE_DEVICE_LIMITS : DESKTOP_DEVICE_LIMITS;
}

export function detectDeviceMode(windowLike?: Pick<Window, "matchMedia" | "innerWidth">): DeviceMode {
  if (!windowLike) {
    return "desktop";
  }
  if (windowLike.matchMedia("(max-width: 768px)").matches || windowLike.innerWidth <= 768) {
    return "mobile_restricted";
  }
  return "desktop";
}
