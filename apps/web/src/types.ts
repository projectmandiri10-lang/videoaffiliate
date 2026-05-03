export type PlatformId = "tiktok" | "youtube" | "facebook" | "shopee";

export type CtaMode = "random" | "sequential";

export type VoiceGender = "female" | "male" | "neutral";

export type PlatformStatus = "pending" | "running" | "done" | "failed" | "interrupted";

export type JobOverallStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "interrupted";

export interface PlatformSettings {
  platformId: PlatformId;
  enabled: boolean;
  voiceName: string;
  speechRate: number;
}

export interface AppSettings {
  scriptModel: string;
  ttsModel: string;
  language: "id-ID";
  maxVideoSeconds: number;
  safetyMode: "safe_marketing";
  ctaPosition: "end";
  ctaMode: CtaMode;
  ctaSequence: Record<PlatformId, number>;
  concurrency: 1;
  platforms: PlatformSettings[];
}

export interface PlatformRun {
  platformId: PlatformId;
  status: PlatformStatus;
  errorMessage?: string;
  scriptPath?: string;
  srtPath?: string;
  mp4Path?: string;
  captionPath?: string;
  captionText?: string;
  hashtags?: string[];
  artifactPaths: string[];
  updatedAt: string;
}

export interface JobRecord {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
  affiliateLink?: string;
  videoPath: string;
  videoMimeType: string;
  videoDurationSec: number;
  overallStatus: JobOverallStatus;
  platforms: PlatformRun[];
}

export interface TtsVoiceOption {
  voiceName: string;
  label: string;
  tone: string;
  gender: VoiceGender;
}

export interface ExcitedVoicePreset {
  presetId: string;
  label: string;
  version: string;
  gender: "female" | "male";
  voiceName: string;
}
