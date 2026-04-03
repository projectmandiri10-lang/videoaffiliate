import type { PlatformId, SubtitleStyle } from "./types.js";

export interface PlatformDefinition {
  label: string;
  voiceStyle: string;
  tone: string;
  hook: string;
  srtStyle: SubtitleStyle;
  defaultVoiceName: string;
  defaultSpeechRate: number;
}

export const PLATFORM_ORDER: PlatformId[] = [
  "tiktok",
  "youtube",
  "facebook",
  "shopee"
];

export const PLATFORM_CONFIG: Record<PlatformId, PlatformDefinition> = {
  tiktok: {
    label: "TikTok",
    voiceStyle: "soft",
    tone: "relatable",
    hook: "curiosity",
    srtStyle: "short_punchy",
    defaultVoiceName: "Leda",
    defaultSpeechRate: 1
  },
  youtube: {
    label: "YouTube Shorts",
    voiceStyle: "medium",
    tone: "informative",
    hook: "problem_solution",
    srtStyle: "clear",
    defaultVoiceName: "Charon",
    defaultSpeechRate: 1
  },
  facebook: {
    label: "Facebook",
    voiceStyle: "evergreen",
    tone: "storytelling",
    hook: "emotional",
    srtStyle: "narrative",
    defaultVoiceName: "Aoede",
    defaultSpeechRate: 1
  },
  shopee: {
    label: "Shopee",
    voiceStyle: "hard",
    tone: "direct",
    hook: "cta",
    srtStyle: "sales",
    defaultVoiceName: "Kore",
    defaultSpeechRate: 1
  }
};

export const PLATFORM_LABELS: Record<PlatformId, string> = PLATFORM_ORDER.reduce(
  (accumulator, platformId) => {
    accumulator[platformId] = PLATFORM_CONFIG[platformId].label;
    return accumulator;
  },
  {} as Record<PlatformId, string>
);
