import type { AppSettings, DeviceLimits, ExcitedVoicePreset, TtsVoiceOption } from "./types.js";
import { PLATFORM_CONFIG, PLATFORM_ORDER, createDefaultCtaSequence } from "./platform-config.js";
import { DEFAULT_GEMINI_SCRIPT_MODEL, DEFAULT_GEMINI_TTS_MODEL } from "./gemini-models.js";

export const MAX_HISTORY = 20;
export const DESKTOP_MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const MOBILE_MAX_UPLOAD_BYTES = 80 * 1024 * 1024;
export const DESKTOP_MAX_VIDEO_SECONDS = 30;
export const MOBILE_MAX_VIDEO_SECONDS = 30;
export const DEFAULT_PORT = 8787;

export const DEFAULT_SETTINGS: AppSettings = {
  scriptModel: DEFAULT_GEMINI_SCRIPT_MODEL,
  ttsModel: DEFAULT_GEMINI_TTS_MODEL,
  language: "id-ID",
  maxVideoSeconds: DESKTOP_MAX_VIDEO_SECONDS,
  safetyMode: "safe_marketing",
  ctaPosition: "end",
  ctaMode: "random",
  ctaSequence: createDefaultCtaSequence(),
  concurrency: 1,
  platforms: PLATFORM_ORDER.map((platformId) => ({
    platformId,
    enabled: platformId === "youtube",
    voiceName: PLATFORM_CONFIG[platformId].defaultVoiceName,
    speechRate: PLATFORM_CONFIG[platformId].defaultSpeechRate
  }))
};

export const GEMINI_TTS_VOICES: TtsVoiceOption[] = [
  { voiceName: "Zephyr", label: "Zephyr", tone: "Bright", gender: "neutral" },
  { voiceName: "Puck", label: "Puck", tone: "Upbeat", gender: "male" },
  { voiceName: "Charon", label: "Charon", tone: "Informative", gender: "male" },
  { voiceName: "Kore", label: "Kore", tone: "Firm", gender: "female" },
  { voiceName: "Fenrir", label: "Fenrir", tone: "Excitable", gender: "male" },
  { voiceName: "Leda", label: "Leda", tone: "Youthful", gender: "female" },
  { voiceName: "Orus", label: "Orus", tone: "Firm", gender: "male" },
  { voiceName: "Aoede", label: "Aoede", tone: "Breezy", gender: "female" },
  { voiceName: "Callirrhoe", label: "Callirrhoe", tone: "Easy-going", gender: "female" },
  { voiceName: "Autonoe", label: "Autonoe", tone: "Bright", gender: "female" },
  { voiceName: "Enceladus", label: "Enceladus", tone: "Breathy", gender: "neutral" },
  { voiceName: "Iapetus", label: "Iapetus", tone: "Clear", gender: "male" },
  { voiceName: "Umbriel", label: "Umbriel", tone: "Easy-going", gender: "neutral" },
  { voiceName: "Algieba", label: "Algieba", tone: "Smooth", gender: "neutral" },
  { voiceName: "Despina", label: "Despina", tone: "Smooth", gender: "female" },
  { voiceName: "Erinome", label: "Erinome", tone: "Clear", gender: "female" },
  { voiceName: "Algenib", label: "Algenib", tone: "Gravelly", gender: "male" },
  { voiceName: "Rasalgethi", label: "Rasalgethi", tone: "Informative", gender: "male" },
  { voiceName: "Laomedeia", label: "Laomedeia", tone: "Upbeat", gender: "female" },
  { voiceName: "Achernar", label: "Achernar", tone: "Soft", gender: "female" },
  { voiceName: "Alnilam", label: "Alnilam", tone: "Firm", gender: "male" },
  { voiceName: "Schedar", label: "Schedar", tone: "Even", gender: "male" },
  { voiceName: "Gacrux", label: "Gacrux", tone: "Mature", gender: "male" },
  { voiceName: "Pulcherrima", label: "Pulcherrima", tone: "Forward", gender: "female" },
  { voiceName: "Achird", label: "Achird", tone: "Friendly", gender: "neutral" },
  { voiceName: "Zubenelgenubi", label: "Zubenelgenubi", tone: "Casual", gender: "neutral" },
  { voiceName: "Vindemiatrix", label: "Vindemiatrix", tone: "Gentle", gender: "female" },
  { voiceName: "Sadachbia", label: "Sadachbia", tone: "Lively", gender: "female" },
  { voiceName: "Sadaltager", label: "Sadaltager", tone: "Knowledgeable", gender: "male" },
  { voiceName: "Sulafat", label: "Sulafat", tone: "Warm", gender: "female" }
];

export const DEFAULT_YOUTUBE_TTS_GENDER = "female";

export const FEATURED_YOUTUBE_TTS_OPTIONS = [
  {
    gender: "female" as const,
    voiceName: "Despina",
    title: "Wanita realistis",
    tone: "Smooth",
    description: "Natural, halus, dan aman untuk narasi affiliate Bahasa Indonesia."
  },
  {
    gender: "male" as const,
    voiceName: "Iapetus",
    title: "Pria realistis",
    tone: "Clear",
    description: "Jernih, tegas, dan tetap enak didengar untuk penjelasan produk singkat."
  }
] as const;

export function getFeaturedYoutubeTtsOption(gender: "female" | "male") {
  return FEATURED_YOUTUBE_TTS_OPTIONS.find((option) => option.gender === gender)!;
}

export function findFeaturedYoutubeTtsOption(voiceName: string) {
  return FEATURED_YOUTUBE_TTS_OPTIONS.find((option) => option.voiceName === voiceName);
}

export const GEMINI_EXCITED_PRESETS: ExcitedVoicePreset[] = [
  {
    presetId: "female_excited_v1",
    label: "Excited Wanita V1",
    version: "v1",
    gender: "female",
    voiceName: "Leda"
  },
  {
    presetId: "female_excited_v2",
    label: "Excited Wanita V2",
    version: "v2",
    gender: "female",
    voiceName: "Autonoe"
  },
  {
    presetId: "female_excited_v3",
    label: "Excited Wanita V3",
    version: "v3",
    gender: "female",
    voiceName: "Sadachbia"
  },
  {
    presetId: "male_excited_v1",
    label: "Excited Pria V1",
    version: "v1",
    gender: "male",
    voiceName: "Fenrir"
  },
  {
    presetId: "male_excited_v2",
    label: "Excited Pria V2",
    version: "v2",
    gender: "male",
    voiceName: "Puck"
  },
  {
    presetId: "male_excited_v3",
    label: "Excited Pria V3",
    version: "v3",
    gender: "male",
    voiceName: "Orus"
  }
];

export const DESKTOP_DEVICE_LIMITS: DeviceLimits = {
  mode: "desktop",
  maxVideoSeconds: DESKTOP_MAX_VIDEO_SECONDS,
  maxUploadBytes: DESKTOP_MAX_UPLOAD_BYTES,
  renderHeight: 1080,
  warning:
    "Workflow YouTube Shorts affiliate dibatasi 30 detik agar hook, CTA, dan render browser tetap cepat."
};

export const MOBILE_DEVICE_LIMITS: DeviceLimits = {
  mode: "mobile_restricted",
  maxVideoSeconds: MOBILE_MAX_VIDEO_SECONDS,
  maxUploadBytes: MOBILE_MAX_UPLOAD_BYTES,
  renderHeight: 720,
  warning:
    "Mode mobile membatasi durasi ke 30 detik dan render 720p agar proses browser tetap stabil."
};

export function findTtsVoiceByName(voiceName: string): TtsVoiceOption | undefined {
  return GEMINI_TTS_VOICES.find((voice) => voice.voiceName === voiceName);
}

export function isKnownTtsVoiceName(voiceName: string): boolean {
  return Boolean(findTtsVoiceByName(voiceName));
}
