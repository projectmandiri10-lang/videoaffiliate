import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import {
  type AIService,
  type AppSettings,
  type ClipCandidate,
  type ClipCandidateDraft,
  type JobRecord,
  type PlatformRun,
  type SpeechGenerator
} from "../types.js";
import { PLATFORM_CONFIG } from "../platform-config.js";
import {
  getRenderProfileIdForPlatform,
  pickRenderVariantKey
} from "../render-config.js";
import { buildReelsMetadataPrompt, buildScriptPrompt } from "./prompt-builder.js";
import { SettingsStore } from "../stores/settings-store.js";
import { JobsStore } from "../stores/jobs-store.js";
import { writeWav24kMono } from "../utils/audio.js";
import {
  SHORTS_TARGET_DURATION_SEC,
  buildClipCandidateDrafts,
  pickTopNonOverlappingClipCandidates
} from "../utils/clip-candidates.js";
import { resolveVersionedBaseName } from "../utils/filename.js";
import { ensureSocialMetadata } from "../utils/model-output.js";
import { OUTPUTS_DIR, outputUrlToAbsolutePath } from "../utils/paths.js";
import { renderPlatformVideo } from "../utils/render-video.js";
import { buildSrt } from "../utils/srt.js";
import {
  createVideoPreview,
  detectSceneChangeTimestamps,
  extractAnalysisFramesForRange,
  probeVideoMetadata
} from "../utils/video.js";

interface QueueItem {
  jobId: string;
  mode: "analyze" | "render";
  forceFresh?: boolean;
}

function nowIso(): string {
  return new Date().toISOString();
}

function toOutputUrl(...parts: string[]): string {
  return `/outputs/${parts.map((part) => encodeURIComponent(part)).join("/")}`;
}

function getYoutubeSettings(settings: AppSettings) {
  return settings.platforms.find((platform) => platform.platformId === "youtube") ?? settings.platforms[0]!;
}

function fallbackCaption(title: string, description: string, ctaText: string): string {
  const summary = description.split(".")[0]?.trim() || description.trim();
  return `${title} - ${summary}. ${ctaText}`.replace(/\s+/g, " ").trim().slice(0, 220);
}

function fallbackHashtags(title: string): string[] {
  const titleTags = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 4)
    .map((word) => `#${word}`);
  return [...new Set(["#shorts", "#youtubeshorts", "#affiliate", "#reviewproduk", ...titleTags])];
}

function clampScore(score: number): number {
  return Number(Math.min(10, Math.max(0, score)).toFixed(2));
}

function heuristicScore(
  candidate: Pick<ClipCandidate, "startSec" | "durationSec">,
  durationSec: number
): number {
  const relativeStart = candidate.startSec / Math.max(durationSec, 1);
  const durationOffset = Math.abs(candidate.durationSec - SHORTS_TARGET_DURATION_SEC);
  const hookBias =
    candidate.startSec <= 2
      ? 1.1
      : candidate.startSec <= 6
        ? 0.7
        : candidate.startSec <= 10
          ? 0.25
          : -0.15;
  const lateStartPenalty =
    relativeStart >= 0.65 ? 1.6 : relativeStart >= 0.52 ? 1.05 : relativeStart >= 0.38 ? 0.45 : 0;
  const durationBias =
    candidate.durationSec >= 22 && candidate.durationSec <= 27
      ? 0.75
      : candidate.durationSec >= 20 && candidate.durationSec <= 29
        ? 0.35
        : -0.35;
  const durationPenalty = durationOffset * 0.16;

  return clampScore(7.5 + hookBias + durationBias - durationPenalty - lateStartPenalty);
}

function finalizeShortsScore(
  candidate: Pick<ClipCandidate, "startSec" | "durationSec">,
  durationSec: number,
  aiScore: number
): number {
  const heuristic = heuristicScore(candidate, durationSec);
  if (!Number.isFinite(aiScore) || aiScore <= 0) {
    return heuristic;
  }

  const relativeStart = candidate.startSec / Math.max(durationSec, 1);
  const blendedScore = aiScore * 0.72 + heuristic * 0.28;
  const earlyHookBoost = candidate.startSec <= 3 ? 0.25 : 0;
  const ctaRunwayBoost = candidate.durationSec >= 22 && candidate.durationSec <= 27 ? 0.2 : 0;
  const lateHookPenalty = relativeStart >= 0.55 ? 0.55 : relativeStart >= 0.42 ? 0.2 : 0;
  return clampScore(blendedScore + earlyHookBoost + ctaRunwayBoost - lateHookPenalty);
}

async function safeCleanup(paths: Array<string | undefined>): Promise<void> {
  await Promise.all(
    paths
      .filter((filePath): filePath is string => Boolean(filePath))
      .map((filePath) => rm(filePath, { recursive: false, force: true }))
  );
}

function listPreviewPaths(job: JobRecord): string[] {
  return (job.clipCandidates ?? [])
    .map((candidate) => candidate.previewPath)
    .filter((value): value is string => Boolean(value))
    .map((value) => outputUrlToAbsolutePath(value))
    .filter((value): value is string => Boolean(value));
}

function listFinalRenderPaths(job: JobRecord): string[] {
  return [job.finalRender?.mp4Path, job.finalRender?.captionPath, job.finalRender?.srtPath]
    .filter((value): value is string => Boolean(value))
    .map((value) => outputUrlToAbsolutePath(value))
    .filter((value): value is string => Boolean(value));
}

function getOrCreateYoutubePlatform(job: JobRecord): PlatformRun {
  return (
    job.platforms.find((platform) => platform.platformId === "youtube") ?? {
      platformId: "youtube",
      status: "pending",
      renderProfileId: getRenderProfileIdForPlatform("youtube"),
      renderVariantKey: pickRenderVariantKey(job.jobId, "youtube", getRenderProfileIdForPlatform("youtube")),
      artifactPaths: [],
      updatedAt: job.updatedAt
    }
  );
}

export interface IJobProcessor {
  enqueueAnalysis(jobId: string, options?: { forceFresh?: boolean }): void;
  enqueueRender(jobId: string, options?: { forceFresh?: boolean }): void;
  whenIdle(): Promise<void>;
}

export class JobProcessor implements IJobProcessor {
  private readonly queue: QueueItem[] = [];
  private running = false;
  private idleResolvers: Array<() => void> = [];

  public constructor(
    private readonly jobsStore: JobsStore,
    private readonly settingsStore: SettingsStore,
    private readonly aiService: AIService,
    private readonly speechGenerator: SpeechGenerator,
    private readonly logger: FastifyBaseLogger
  ) {}

  public enqueueAnalysis(jobId: string, options?: { forceFresh?: boolean }): void {
    this.queue.push({ jobId, mode: "analyze", forceFresh: options?.forceFresh });
    void this.consume();
  }

  public enqueueRender(jobId: string, options?: { forceFresh?: boolean }): void {
    this.queue.push({ jobId, mode: "render", forceFresh: options?.forceFresh });
    void this.consume();
  }

  public async whenIdle(): Promise<void> {
    if (!this.running && this.queue.length === 0) {
      return;
    }
    await new Promise<void>((resolve) => {
      this.idleResolvers.push(resolve);
    });
  }

  private resolveIdle(): void {
    if (this.running || this.queue.length > 0) {
      return;
    }
    for (const resolve of this.idleResolvers.splice(0)) {
      resolve();
    }
  }

  private async consume(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (!item) {
        break;
      }
      const shouldProcess = await this.shouldProcessQueueItem(item);
      if (!shouldProcess) {
        this.logger.info({ jobId: item.jobId, mode: item.mode }, "Melewati job stale yang tidak lagi aktif.");
        continue;
      }
      try {
        if (item.mode === "analyze") {
          await this.processAnalysis(item.jobId, Boolean(item.forceFresh));
        } else {
          await this.processRender(item.jobId, Boolean(item.forceFresh));
        }
      } catch (error) {
        this.logger.error({ err: error, jobId: item.jobId, mode: item.mode }, "Processor gagal.");
      }
    }
    this.running = false;
    this.resolveIdle();
  }

  private async shouldProcessQueueItem(item: QueueItem): Promise<boolean> {
    const job = await this.jobsStore.getById(item.jobId);
    if (!job) {
      return false;
    }

    if (item.mode === "analyze") {
      return job.analysisStatus === "pending" || job.analysisStatus === "running";
    }

    return Boolean(
      job.selectedClipId &&
        (job.finalRender?.status === "pending" || job.finalRender?.status === "running")
    );
  }

  private async processAnalysis(jobId: string, forceFresh: boolean): Promise<void> {
    const job = await this.jobsStore.ensureSourceVideo(jobId);
    if (!job) {
      return;
    }

    const youtubePlatform = getOrCreateYoutubePlatform(job);
    await this.jobsStore.update(jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      workflow: "youtube_shorts",
      overallStatus: "running",
      analysisStatus: "running",
      analysisErrorMessage: undefined,
      selectedClipId: forceFresh ? undefined : current.selectedClipId,
      finalRender: forceFresh
        ? {
            status: "idle",
            updatedAt: nowIso()
          }
        : current.finalRender,
      platforms: [
        {
          ...youtubePlatform,
          status: "pending",
          errorMessage: undefined,
          updatedAt: nowIso()
        }
      ]
    }));

    const previewOutputPaths = forceFresh ? [...listPreviewPaths(job)] : [];
    const staleRenderPaths = forceFresh ? [...listFinalRenderPaths(job)] : [];

    try {
      const settings = await this.settingsStore.get();
      const metadata = await probeVideoMetadata(job.videoPath);
      const sceneChanges = await detectSceneChangeTimestamps(job.videoPath).catch((error) => {
        this.logger.warn({ err: error, jobId }, "Scene detection gagal, fallback ke window heuristik.");
        return [];
      });
      const draftRanges = buildClipCandidateDrafts(metadata.durationSec, sceneChanges);
      if (!draftRanges.length) {
        throw new Error("Video terlalu pendek. Minimal 18 detik untuk workflow YouTube Shorts.");
      }

      const draftCandidates: ClipCandidateDraft[] = [];
      const previewDir = path.join(OUTPUTS_DIR, "youtube", "previews");
      await mkdir(previewDir, { recursive: true });

      for (const draft of draftRanges) {
        const frameTimestamps = draft.frameTimestamps.length
          ? draft.frameTimestamps
          : [draft.startSec, draft.startSec + draft.durationSec / 2, draft.endSec - 0.1]
              .map((value) => Number(value.toFixed(3)));
        const frames = await extractAnalysisFramesForRange(
          job.videoPath,
          draft.startSec,
          draft.endSec,
          `${job.jobId}-${draft.clipId}`
        );
        draftCandidates.push({
          ...draft,
          frameTimestamps,
          frames
        });
      }

      const scoredByAi = await this.aiService
        .analyzeClipCandidates({
          model: settings.scriptModel,
          title: job.title,
          description: job.description,
          affiliateLink: job.affiliateLink ?? "",
          candidates: draftCandidates
        })
        .catch((error) => {
          this.logger.warn({ err: error, jobId }, "Analisis kandidat clip via AI gagal, fallback ke skor heuristik.");
          return draftCandidates.map<ClipCandidate>((candidate) => ({
            clipId: candidate.clipId,
            startSec: candidate.startSec,
            endSec: candidate.endSec,
            durationSec: candidate.durationSec,
            frameTimestamps: candidate.frameTimestamps,
            score: heuristicScore(candidate, metadata.durationSec),
            reason: "Dipilih dengan heuristik karena analisis AI tidak tersedia."
          }));
        });

      const merged = scoredByAi.map((candidate, index) => {
        const draft = draftCandidates.find((item) => item.clipId === candidate.clipId) ?? draftCandidates[index]!;
        const previewFilename = `${job.jobId}-${candidate.clipId}.mp4`;
        const previewPath = path.join(previewDir, previewFilename);
        const finalScore = finalizeShortsScore(candidate, metadata.durationSec, candidate.score);
        return {
          ...candidate,
          startSec: draft.startSec,
          endSec: draft.endSec,
          durationSec: draft.durationSec,
          frameTimestamps: draft.frameTimestamps,
          previewPath,
          score: finalScore,
          reason: candidate.reason || "Potongan ini punya ritme visual yang cukup jelas untuk Shorts."
        };
      });

      for (const candidate of merged) {
        await createVideoPreview(job.videoPath, candidate.previewPath!, candidate.startSec, candidate.durationSec);
      }

      const shortlisted = pickTopNonOverlappingClipCandidates(
        merged.map((candidate) => ({
          ...candidate,
          previewPath: toOutputUrl("youtube", "previews", path.basename(candidate.previewPath!))
        })),
        3
      );
      if (!shortlisted.length) {
        throw new Error("Backend gagal menemukan kandidat clip yang valid.");
      }

      await safeCleanup([...previewOutputPaths, ...staleRenderPaths]);
      await this.jobsStore.update(jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        workflow: "youtube_shorts",
        overallStatus: "queued",
        analysisStatus: "done",
        analysisErrorMessage: undefined,
        clipCandidates: shortlisted,
        selectedClipId: undefined,
        finalRender: {
          status: "idle",
          updatedAt: nowIso()
        },
        platforms: [
          {
            ...getOrCreateYoutubePlatform(current),
            status: "pending",
            errorMessage: undefined,
            mp4Path: undefined,
            captionPath: undefined,
            srtPath: undefined,
            captionText: undefined,
            hashtags: undefined,
            scriptText: undefined,
            artifactPaths: [],
            updatedAt: nowIso()
          }
        ]
      }));
    } catch (error) {
      await safeCleanup(previewOutputPaths);
      await this.jobsStore.update(jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        workflow: "youtube_shorts",
        overallStatus: "failed",
        analysisStatus: "failed",
        analysisErrorMessage: error instanceof Error ? error.message : String(error),
        platforms: [
          {
            ...getOrCreateYoutubePlatform(current),
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso()
          }
        ]
      }));
    }
  }

  private async processRender(jobId: string, _forceFresh: boolean): Promise<void> {
    const job = await this.jobsStore.ensureSourceVideo(jobId);
    if (!job) {
      return;
    }

    const candidate = (job.clipCandidates ?? []).find((item) => item.clipId === job.selectedClipId);
    if (!candidate) {
      await this.jobsStore.update(jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        overallStatus: "failed",
        finalRender: {
          ...current.finalRender,
          status: "failed",
          errorMessage: "Kandidat clip belum dipilih atau tidak ditemukan.",
          updatedAt: nowIso()
        },
        platforms: [
          {
            ...getOrCreateYoutubePlatform(current),
            status: "failed",
            errorMessage: "Kandidat clip belum dipilih atau tidak ditemukan.",
            updatedAt: nowIso()
          }
        ]
      }));
      return;
    }

    await this.jobsStore.update(jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      workflow: "youtube_shorts",
      overallStatus: "running",
      finalRender: {
        ...current.finalRender,
        status: "running",
        errorMessage: undefined,
        updatedAt: nowIso()
      },
      platforms: [
        {
          ...getOrCreateYoutubePlatform(current),
          status: "running",
          errorMessage: undefined,
          updatedAt: nowIso()
        }
      ]
    }));

    const uploadDir = path.join(path.dirname(job.videoPath));
    const tempSrtPath = path.join(uploadDir, `youtube-${candidate.clipId}-render.srt`);
    const tempWavPath = path.join(uploadDir, `youtube-${candidate.clipId}-tts.wav`);

    try {
      const settings = await this.settingsStore.get();
      const youtubeSettings = getYoutubeSettings(settings);
      const selectedCta = await this.settingsStore.pickCta("youtube");
      const frames = await extractAnalysisFramesForRange(
        job.videoPath,
        candidate.startSec,
        candidate.endSec,
        `${job.jobId}-${candidate.clipId}-render`
      );
      const scriptPrompt = buildScriptPrompt({
        settings,
        platformId: "youtube",
        title: job.title,
        description: job.description,
        videoDurationSec: candidate.durationSec,
        ctaText: selectedCta.ctaText
      });
      const scriptText = await this.aiService.generateScript({
        model: settings.scriptModel,
        prompt: scriptPrompt,
        frames
      });

      const fallbackSocial = {
        caption: fallbackCaption(job.title, job.description, selectedCta.ctaText),
        hashtags: fallbackHashtags(job.title)
      };
      const socialMetadata = ensureSocialMetadata(
        await this.aiService.generateSocialMetadata({
          model: settings.scriptModel,
          title: job.title,
          description: job.description,
          platformId: "youtube",
          scriptText,
          ctaText: selectedCta.ctaText
        }),
        fallbackSocial.caption,
        fallbackSocial.hashtags
      );

      const audio = await this.speechGenerator.generateSpeech({
        model: settings.ttsModel,
        text: scriptText,
        voiceName: youtubeSettings.voiceName,
        speechRate: youtubeSettings.speechRate
      });
      await writeWav24kMono(audio.data, audio.mimeType, tempWavPath, youtubeSettings.speechRate);

      const outputDir = path.join(OUTPUTS_DIR, "youtube");
      await mkdir(outputDir, { recursive: true });
      const baseName = await resolveVersionedBaseName({
        directory: outputDir,
        preferredBaseName: job.title,
        suffixes: [".mp4", ".srt", "-caption.txt"]
      });
      const mp4Path = path.join(outputDir, `${baseName}.mp4`);
      const srtPath = path.join(outputDir, `${baseName}.srt`);
      const captionPath = path.join(outputDir, `${baseName}-caption.txt`);
      const srtText = buildSrt(scriptText, candidate.durationSec, PLATFORM_CONFIG.youtube.srtStyle);
      await writeFile(tempSrtPath, srtText, "utf8");
      await writeFile(srtPath, srtText, "utf8");

      const metadata = await probeVideoMetadata(job.videoPath);
      await renderPlatformVideo({
        sourceVideoPath: job.videoPath,
        voiceWavPath: tempWavPath,
        subtitlePath: tempSrtPath,
        outputVideoPath: mp4Path,
        targetDurationSec: candidate.durationSec,
        clipStartSec: candidate.startSec,
        clipDurationSec: candidate.durationSec,
        videoMetadata: metadata,
        renderProfileId: getRenderProfileIdForPlatform("youtube"),
        renderVariantKey: pickRenderVariantKey(job.jobId, "youtube", getRenderProfileIdForPlatform("youtube")),
        titleText: job.title,
        ctaText: selectedCta.ctaText
      });

      const captionParts = [
        socialMetadata.caption,
        socialMetadata.hashtags.join(" "),
        job.affiliateLink?.trim() ?? ""
      ].filter((value) => value.length > 0);
      await writeFile(captionPath, `${captionParts.join("\n\n")}\n`, "utf8");

      await safeCleanup(listFinalRenderPaths(job));
      await this.jobsStore.update(jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        workflow: "youtube_shorts",
        overallStatus: "success",
        finalRender: {
          status: "done",
          scriptText,
          captionText: socialMetadata.caption,
          hashtags: socialMetadata.hashtags,
          mp4Path: toOutputUrl("youtube", path.basename(mp4Path)),
          srtPath: toOutputUrl("youtube", path.basename(srtPath)),
          captionPath: toOutputUrl("youtube", path.basename(captionPath)),
          updatedAt: nowIso()
        },
        platforms: [
          {
            ...getOrCreateYoutubePlatform(current),
            status: "done",
            errorMessage: undefined,
            scriptText,
            captionText: socialMetadata.caption,
            hashtags: socialMetadata.hashtags,
            mp4Path: toOutputUrl("youtube", path.basename(mp4Path)),
            srtPath: toOutputUrl("youtube", path.basename(srtPath)),
            captionPath: toOutputUrl("youtube", path.basename(captionPath)),
            artifactPaths: [
              toOutputUrl("youtube", path.basename(mp4Path)),
              toOutputUrl("youtube", path.basename(srtPath)),
              toOutputUrl("youtube", path.basename(captionPath))
            ],
            updatedAt: nowIso()
          }
        ]
      }));
    } catch (error) {
      await this.jobsStore.update(jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        workflow: "youtube_shorts",
        overallStatus: "failed",
        finalRender: {
          ...current.finalRender,
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          updatedAt: nowIso()
        },
        platforms: [
          {
            ...getOrCreateYoutubePlatform(current),
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            updatedAt: nowIso()
          }
        ]
      }));
    } finally {
      await safeCleanup([tempSrtPath, tempWavPath]);
    }
  }
}
