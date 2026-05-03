export type PlatformId = "tiktok" | "youtube" | "facebook" | "shopee";

export type SubtitleStyle = "short_punchy" | "clear" | "narrative" | "sales";

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
  retryAfter?: string;
  scriptPath?: string;
  srtPath?: string;
  mp4Path?: string;
  captionPath?: string;
  captionText?: string;
  hashtags?: string[];
  scriptText?: string;
  selectedCtaText?: string;
  selectedCtaIndex?: number;
  scriptCacheKey?: string;
  captionCacheKey?: string;
  ttsCacheKey?: string;
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

export interface UploadedModelFile {
  fileId?: string;
  filename: string;
  mimeType: string;
  inlineDataBase64?: string;
}

export interface GenerateScriptInput {
  model: string;
  prompt: string;
  video: UploadedModelFile;
}

export interface GenerateSpeechInput {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
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

export interface SocialMetadata {
  caption: string;
  hashtags: string[];
}

export interface GenerateSocialMetadataInput {
  model: string;
  title: string;
  description: string;
  platformId: PlatformId;
  scriptText: string;
  ctaText: string;
}

export interface AIService {
  uploadVideo(
    filePath: string,
    mimeType: string,
    targetModel: string
  ): Promise<UploadedModelFile>;
  generateScript(input: GenerateScriptInput): Promise<string>;
  generateSocialMetadata(input: GenerateSocialMetadataInput): Promise<SocialMetadata>;
}

export interface SpeechGenerator {
  generateSpeech(input: GenerateSpeechInput): Promise<{ data: Buffer; mimeType: string }>;
}
