import { createHash } from "node:crypto";
import { PLATFORM_CONFIG } from "./platform-config.js";
import type { PlatformId, RenderProfileId } from "./types.js";

export interface RenderVariantDefinition {
  key: string;
  cropZoom: number;
  anchorX: number;
  anchorY: number;
  subtitleMarginVRatio: number;
}

export interface SubtitleThemeDefinition {
  fontFamily: string;
  fontAsset: string;
  minFontSize: number;
  fontSizeRatio: number;
  primaryColor: string;
  outlineColor: string;
  backColor: string;
  borderStyle: 1 | 3;
  outline: number;
  shadow: number;
  alignment: 2 | 8;
  minMarginV: number;
  marginVRatio: number;
  scaleX?: number;
}

export interface TextThemeDefinition {
  fontFamily: string;
  fontAsset: string;
  fontColor: string;
}

export interface RenderProfileDefinition {
  id: RenderProfileId;
  label: string;
  burnSubtitles: boolean;
  subtitleTheme?: SubtitleThemeDefinition;
  textTheme?: TextThemeDefinition;
  introDurationSec: number;
  outroDurationSec: number;
  introKicker: string;
  introAccent: string;
  outroAccent: string;
  ctaOverlayText: string;
  midBadgeText?: string;
  color: {
    brightness: number;
    contrast: number;
    saturation: number;
    gamma?: number;
  };
  sharpenAmount: number;
  variants: RenderVariantDefinition[];
}

export const RENDERER_VERSION = "platform-renderer-v4-visual-audit";

export const RENDER_PROFILES: Record<RenderProfileId, RenderProfileDefinition> = {
  native_source: {
    id: "native_source",
    label: "Native Source",
    burnSubtitles: false,
    introDurationSec: 0,
    outroDurationSec: 0,
    introKicker: "Native",
    introAccent: "#161616",
    outroAccent: "#161616",
    ctaOverlayText: "",
    color: {
      brightness: 0,
      contrast: 1,
      saturation: 1
    },
    sharpenAmount: 0,
    variants: [
      {
        key: "native_base",
        cropZoom: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        subtitleMarginVRatio: 0.12
      }
    ]
  },
  youtube_editorial: {
    id: "youtube_editorial",
    label: "YouTube Editorial",
    burnSubtitles: true,
    subtitleTheme: {
      fontFamily: "Barlow Semi Condensed",
      fontAsset: "BarlowSemiCondensed-SemiBold.ttf",
      minFontSize: 28,
      fontSizeRatio: 0.034,
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00111111",
      backColor: "&H70101010",
      borderStyle: 1,
      outline: 2.6,
      shadow: 0.4,
      alignment: 2,
      minMarginV: 58,
      marginVRatio: 0.075
    },
    textTheme: {
      fontFamily: "Barlow Semi Condensed",
      fontAsset: "BarlowSemiCondensed-SemiBold.ttf",
      fontColor: "white"
    },
    introDurationSec: 0.6,
    outroDurationSec: 0.8,
    introKicker: "SHORT REVIEW",
    introAccent: "#ef4444",
    outroAccent: "#0f172a",
    ctaOverlayText: "Cek link produk di deskripsi",
    color: {
      brightness: 0.01,
      contrast: 1.05,
      saturation: 1.04
    },
    sharpenAmount: 0.45,
    variants: [
      {
        key: "editorial_center",
        cropZoom: 1.03,
        anchorX: 0.5,
        anchorY: 0.48,
        subtitleMarginVRatio: 0.075
      },
      {
        key: "editorial_right",
        cropZoom: 1.04,
        anchorX: 0.62,
        anchorY: 0.44,
        subtitleMarginVRatio: 0.08
      },
      {
        key: "editorial_left",
        cropZoom: 1.035,
        anchorX: 0.38,
        anchorY: 0.46,
        subtitleMarginVRatio: 0.075
      }
    ]
  },
  facebook_story: {
    id: "facebook_story",
    label: "Facebook Story",
    burnSubtitles: true,
    subtitleTheme: {
      fontFamily: "Nunito Sans",
      fontAsset: "NunitoSans-Variable.ttf",
      minFontSize: 27,
      fontSizeRatio: 0.032,
      primaryColor: "&H00F4F6FF",
      outlineColor: "&H002A2A33",
      backColor: "&H4A2B3748",
      borderStyle: 1,
      outline: 1.8,
      shadow: 0.2,
      alignment: 2,
      minMarginV: 104,
      marginVRatio: 0.18
    },
    textTheme: {
      fontFamily: "Nunito Sans",
      fontAsset: "NunitoSans-Variable.ttf",
      fontColor: "#f8f6ef"
    },
    introDurationSec: 1,
    outroDurationSec: 1,
    introKicker: "CERITA PRODUK",
    introAccent: "#f97316",
    outroAccent: "#78350f",
    ctaOverlayText: "Lihat link di komentar atau deskripsi",
    color: {
      brightness: 0.02,
      contrast: 1.03,
      saturation: 1.08,
      gamma: 1.02
    },
    sharpenAmount: 0.22,
    variants: [
      {
        key: "story_center",
        cropZoom: 1.02,
        anchorX: 0.5,
        anchorY: 0.5,
        subtitleMarginVRatio: 0.13
      },
      {
        key: "story_upper",
        cropZoom: 1.025,
        anchorX: 0.5,
        anchorY: 0.4,
        subtitleMarginVRatio: 0.14
      },
      {
        key: "story_right",
        cropZoom: 1.03,
        anchorX: 0.58,
        anchorY: 0.48,
        subtitleMarginVRatio: 0.14
      }
    ]
  },
  shopee_sales: {
    id: "shopee_sales",
    label: "Shopee Sales",
    burnSubtitles: true,
    subtitleTheme: {
      fontFamily: "Archivo",
      fontAsset: "Archivo-Variable.ttf",
      minFontSize: 29,
      fontSizeRatio: 0.035,
      primaryColor: "&H00FFFFFF",
      outlineColor: "&H00101A22",
      backColor: "&H80214AFA",
      borderStyle: 1,
      outline: 2.8,
      shadow: 0.4,
      alignment: 2,
      minMarginV: 92,
      marginVRatio: 0.16,
      scaleX: 92
    },
    textTheme: {
      fontFamily: "Archivo",
      fontAsset: "Archivo-Variable.ttf",
      fontColor: "white"
    },
    introDurationSec: 0.65,
    outroDurationSec: 0.9,
    introKicker: "PROMO PILIHAN",
    introAccent: "#f97316",
    outroAccent: "#ea580c",
    ctaOverlayText: "Buka produk di Shopee sekarang",
    midBadgeText: "Cek produk",
    color: {
      brightness: 0.015,
      contrast: 1.09,
      saturation: 1.12
    },
    sharpenAmount: 0.62,
    variants: [
      {
        key: "sales_center",
        cropZoom: 1.05,
        anchorX: 0.5,
        anchorY: 0.48,
        subtitleMarginVRatio: 0.16
      },
      {
        key: "sales_right",
        cropZoom: 1.06,
        anchorX: 0.6,
        anchorY: 0.46,
        subtitleMarginVRatio: 0.17
      },
      {
        key: "sales_left",
        cropZoom: 1.055,
        anchorX: 0.4,
        anchorY: 0.47,
        subtitleMarginVRatio: 0.17
      }
    ]
  }
};

export const RENDER_PROFILE_LABELS: Record<RenderProfileId, string> = Object.fromEntries(
  Object.values(RENDER_PROFILES).map((profile) => [profile.id, profile.label])
) as Record<RenderProfileId, string>;

export function getRenderProfileIdForPlatform(platformId: PlatformId): RenderProfileId {
  return PLATFORM_CONFIG[platformId].renderProfileId;
}

export function getRenderProfile(profileId: RenderProfileId): RenderProfileDefinition {
  return RENDER_PROFILES[profileId];
}

export function resolveRenderVariant(
  profileId: RenderProfileId,
  variantKey?: string
): RenderVariantDefinition {
  const profile = getRenderProfile(profileId);
  return profile.variants.find((variant) => variant.key === variantKey) ?? profile.variants[0]!;
}

export function pickRenderVariantKey(
  jobId: string,
  platformId: PlatformId,
  profileId: RenderProfileId
): string {
  const profile = getRenderProfile(profileId);
  const digest = createHash("sha256")
    .update(`${jobId}:${platformId}:${profileId}`)
    .digest("hex");
  const index = Number.parseInt(digest.slice(0, 8), 16) % profile.variants.length;
  return profile.variants[index]?.key ?? profile.variants[0]!.key;
}
