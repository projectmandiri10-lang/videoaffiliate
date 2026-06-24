export type PlatformId = "tiktok" | "youtube" | "facebook" | "shopee";

export type SubtitleStyle = "short_punchy" | "clear" | "narrative" | "sales";

export type CtaMode = "random" | "sequential";

export type VoiceGender = "female" | "male" | "neutral";

export type RenderProfileId =
  | "native_source"
  | "youtube_editorial"
  | "facebook_story"
  | "shopee_sales";

export type PlatformStatus = "pending" | "running" | "done" | "failed" | "interrupted";

export type VisualAuditStatus = "passed" | "boosted" | "failed" | "skipped";

export type JobOverallStatus =
  | "queued"
  | "running"
  | "success"
  | "partial_success"
  | "failed"
  | "interrupted";

export type AnalysisStatus = "pending" | "running" | "done" | "failed" | "interrupted";

export type FinalRenderStatus =
  | "idle"
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "interrupted";

export type DeviceMode = "desktop" | "mobile_restricted";

export type ArtifactStorage = "opfs" | "idb";

export interface LocalArtifactRef {
  artifactId: string;
  fileName: string;
  mimeType: string;
  size: number;
  storage: ArtifactStorage;
  createdAt: string;
}

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
  renderProfileId?: RenderProfileId;
  renderVariantKey?: string;
  renderCacheKey?: string;
  visualAuditScore?: number;
  visualAuditStatus?: VisualAuditStatus;
  visualAuditBoosted?: boolean;
  errorMessage?: string;
  retryAfter?: string;
  titleOverride?: string;
  descriptionOverride?: string;
  affiliateLinkOverride?: string;
  scriptPath?: LocalArtifactRef;
  srtPath?: LocalArtifactRef;
  mp4Path?: LocalArtifactRef;
  captionPath?: LocalArtifactRef;
  captionText?: string;
  hashtags?: string[];
  scriptText?: string;
  selectedCtaText?: string;
  selectedCtaIndex?: number;
  scriptCacheKey?: string;
  captionCacheKey?: string;
  ttsCacheKey?: string;
  artifactPaths: LocalArtifactRef[];
  updatedAt: string;
}

export interface ClipCandidate {
  clipId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  score: number;
  reason: string;
  previewPath?: LocalArtifactRef;
  frameTimestamps: number[];
}

export interface FinalRenderRecord {
  status: FinalRenderStatus;
  errorMessage?: string;
  scriptText?: string;
  captionText?: string;
  hashtags?: string[];
  srtPath?: LocalArtifactRef;
  mp4Path?: LocalArtifactRef;
  captionPath?: LocalArtifactRef;
  previewAudioPath?: LocalArtifactRef;
  updatedAt: string;
}

export interface JobRuntimeState {
  deviceMode: DeviceMode;
  stage:
    | "idle"
    | "validating"
    | "preparing"
    | "analyzing"
    | "selecting_clip"
    | "rendering"
    | "persisting"
    | "done";
  progress: number;
  statusMessage?: string;
  interruptReason?: string;
  lastWorkerLog?: string;
}

export interface JobRecord {
  jobId: string;
  createdAt: string;
  updatedAt: string;
  title: string;
  description: string;
  affiliateLink?: string;
  videoPath: LocalArtifactRef;
  videoMimeType: string;
  videoDurationSec: number;
  overallStatus: JobOverallStatus;
  workflow?: "youtube_shorts";
  analysisStatus?: AnalysisStatus;
  analysisErrorMessage?: string;
  clipCandidates?: ClipCandidate[];
  selectedClipId?: string;
  finalRender?: FinalRenderRecord;
  platforms: PlatformRun[];
  runtime: JobRuntimeState;
}

export interface AnalysisFrame {
  dataUrl: string;
  timestampSec: number;
}

export interface GenerateScriptInput {
  model: string;
  prompt: string;
  frames: AnalysisFrame[];
}

export interface GenerateSpeechInput {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
}

export interface ClipCandidateDraft {
  clipId: string;
  startSec: number;
  endSec: number;
  durationSec: number;
  frameTimestamps: number[];
  frames: AnalysisFrame[];
}

export interface AnalyzeClipCandidatesInput {
  model: string;
  title: string;
  description: string;
  affiliateLink: string;
  candidates: ClipCandidateDraft[];
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

export interface DeviceLimits {
  mode: DeviceMode;
  maxVideoSeconds: number;
  maxUploadBytes: number;
  renderHeight: number;
  warning: string;
}
