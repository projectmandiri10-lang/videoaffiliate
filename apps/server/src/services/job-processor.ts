import { createHash } from "node:crypto";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type {
  AIService,
  AppSettings,
  JobRecord,
  PlatformId,
  PlatformRun,
  RenderProfileId,
  SocialMetadata,
  SpeechGenerator,
  VisualAuditStatus
} from "../types.js";
import { PLATFORM_CONFIG, PLATFORM_LABELS } from "../platform-config.js";
import {
  RENDERER_VERSION,
  getRenderProfileIdForPlatform,
  pickRenderVariantKey
} from "../render-config.js";
import { JobsStore } from "../stores/jobs-store.js";
import { SettingsStore } from "../stores/settings-store.js";
import { buildReelsMetadataPrompt, buildScriptPrompt } from "./prompt-builder.js";
import { OUTPUTS_DIR, outputUrlToAbsolutePath } from "../utils/paths.js";
import { writeWav24kMono } from "../utils/audio.js";
import { renderPlatformVideo } from "../utils/render-video.js";
import { formatCtaAsSentence } from "../utils/cta.js";
import { ensureSocialMetadata } from "../utils/model-output.js";
import { resolveVersionedBaseName } from "../utils/filename.js";
import { writeCaptionArtifactForPlatform } from "../utils/caption-artifact.js";
import { getEffectivePlatformMetadata } from "../utils/job-normalization.js";
import { buildSrt } from "../utils/srt.js";
import { probeVideoMetadata } from "../utils/video.js";
import { compareVideoVisualDifference } from "../utils/visual-audit.js";
import {
  buildRateLimitErrorMessage,
  extractErrorMessage,
  getRetryDelayMs,
  isRateLimitError
} from "../utils/llm-error.js";

interface QueueItem {
  jobId: string;
  platformIds?: PlatformId[];
  forceFresh?: boolean;
}

interface SelectedCtaState {
  ctaMode: AppSettings["ctaMode"];
  ctaText: string;
  ctaIndex: number;
}

const DEFAULT_RETRY_COOLDOWN_MS = 10_000;
const DEFAULT_RATE_LIMIT_COOLDOWN_MS = 15_000;
const VISUAL_AUDIT_TIKTOK_MIN_SCORE = 5;
const VISUAL_AUDIT_NON_TIKTOK_MIN_SCORE = 4;
const VISUAL_AUDIT_REFERENCE_PLATFORM: PlatformId = "tiktok";

function nowIso(): string {
  return new Date().toISOString();
}

function findPlatformSettings(settings: AppSettings, platformId: PlatformId) {
  return settings.platforms.find((platform) => platform.platformId === platformId);
}

function fallbackCaption(title: string, description: string, ctaText: string): string {
  const shortDescription = description.split(".")[0]?.trim() || description.trim();
  const ctaSentence = formatCtaAsSentence(ctaText);
  return `${title} - ${shortDescription}. ${ctaSentence}`
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 220);
}

function fallbackHashtags(title: string, platformId: PlatformId): string[] {
  const words = title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/gi, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3)
    .slice(0, 4)
    .map((word) => `#${word}`);

  const baseByPlatform: Record<PlatformId, string[]> = {
    tiktok: ["#tiktok", "#affiliate", "#fyp", "#belanjaonline"],
    youtube: ["#shorts", "#youtubeshorts", "#affiliate", "#reviewproduk"],
    facebook: ["#facebookreels", "#affiliate", "#rekomendasiproduk", "#belanjaonline"],
    shopee: ["#shopee", "#racunshopee", "#affiliate", "#belanjaonline"]
  };

  return [...baseByPlatform[platformId], ...words];
}

function hashValue(input: unknown): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

function buildScriptCacheKey(model: string, prompt: string): string {
  return hashValue({
    stage: "script",
    model,
    prompt
  });
}

function buildCaptionCacheKey(model: string, prompt: string): string {
  return hashValue({
    stage: "caption",
    model,
    prompt
  });
}

function buildTtsCacheKey(input: {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
}): string {
  return hashValue({
    stage: "tts",
    ...input
  });
}

function buildRenderCacheKey(input: {
  sourceVideoPath: string;
  sourceDurationSec: number;
  sourceWidth: number;
  sourceHeight: number;
  sourceRotation: number;
  scriptText: string;
  title: string;
  description: string;
  ctaText: string;
  renderProfileId: RenderProfileId;
  renderVariantKey: string;
  auditBoost: boolean;
  rendererVersion: string;
}): string {
  return hashValue({
    stage: "render",
    ...input
  });
}

interface VisualAuditResult {
  status: VisualAuditStatus;
  score?: number;
  message?: string;
}

function buildRetryAfter(error: unknown): string {
  const cooldownMs = isRateLimitError(error)
    ? getRetryDelayMs(error, DEFAULT_RATE_LIMIT_COOLDOWN_MS)
    : DEFAULT_RETRY_COOLDOWN_MS;
  return new Date(Date.now() + cooldownMs).toISOString();
}

function toOutputUrl(platformId: PlatformId, filename: string): string {
  return `/outputs/${platformId}/${encodeURIComponent(filename)}`;
}

function resolveOutputPath(outputUrl?: string): string | undefined {
  if (!outputUrl) {
    return undefined;
  }
  return outputUrlToAbsolutePath(outputUrl);
}

function listPlatformArtifactUrls(platform?: PlatformRun): string[] {
  if (!platform) {
    return [];
  }
  return [
    ...new Set(
      [
        ...(platform.artifactPaths || []),
        platform.scriptPath,
        platform.srtPath,
        platform.mp4Path,
        platform.captionPath
      ].filter((value): value is string => Boolean(value))
    )
  ];
}

function listObsoletePlatformArtifactPaths(
  platform: PlatformRun | undefined,
  latestOutputUrls: string[]
): string[] {
  const latest = new Set(latestOutputUrls);
  return listPlatformArtifactUrls(platform)
    .filter((outputUrl) => !latest.has(outputUrl))
    .map((outputUrl) => outputUrlToAbsolutePath(outputUrl))
    .filter((filePath): filePath is string => Boolean(filePath));
}

export interface IJobProcessor {
  enqueue(jobId: string, platformIds?: PlatformId[], options?: { forceFresh?: boolean }): void;
  retryCaption?(jobId: string, platformId: PlatformId): Promise<JobRecord>;
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

  public enqueue(jobId: string, platformIds?: PlatformId[], options?: { forceFresh?: boolean }): void {
    this.queue.push({ jobId, platformIds, forceFresh: options?.forceFresh });
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

  public async retryCaption(jobId: string, platformId: PlatformId): Promise<JobRecord> {
    const job = await this.jobsStore.getById(jobId);
    if (!job) {
      throw new Error("Job tidak ditemukan.");
    }
    if (job.overallStatus === "running") {
      throw new Error("Retry Caption tidak bisa dilakukan saat job sedang running.");
    }

    const platform = job.platforms.find((item) => item.platformId === platformId);
    if (!platform) {
      throw new Error("Platform pada job tidak ditemukan.");
    }
    if (platform.status === "running") {
      throw new Error("Retry Caption tidak bisa dilakukan saat platform sedang running.");
    }
    if (!platform.scriptText?.trim()) {
      throw new Error("Retry Caption butuh script platform. Gunakan Retry Job terlebih dahulu.");
    }

    const settings = await this.settingsStore.get();
    const selectedCta = await this.resolveSelectedCta(jobId, platformId, platform, settings);
    const latestJob = (await this.jobsStore.getById(jobId)) ?? job;
    const latestPlatform =
      latestJob.platforms.find((item) => item.platformId === platformId) ?? platform;
    const metadata = getEffectivePlatformMetadata(latestJob, latestPlatform);
    const scriptText = latestPlatform.scriptText?.trim() || platform.scriptText.trim();
    const fallbackSocial = {
      caption: fallbackCaption(metadata.title, metadata.description, selectedCta.ctaText),
      hashtags: fallbackHashtags(metadata.title, platformId)
    };
    const captionPrompt = buildReelsMetadataPrompt({
      title: metadata.title,
      description: metadata.description,
      platformId,
      scriptText,
      ctaText: selectedCta.ctaText
    });
    const captionCacheKey = buildCaptionCacheKey(settings.scriptModel, captionPrompt);
    const socialMetadata = await (async (): Promise<SocialMetadata> => {
      try {
        const candidate = await this.aiService.generateSocialMetadata({
          model: settings.scriptModel,
          title: metadata.title,
          description: metadata.description,
          platformId,
          scriptText,
          ctaText: selectedCta.ctaText
        });
        return ensureSocialMetadata(candidate, fallbackSocial.caption, fallbackSocial.hashtags);
      } catch (error) {
        this.logger.warn(
          { err: error, jobId, platformId },
          "Retry caption gagal di AI, pakai fallback."
        );
        return fallbackSocial;
      }
    })();

    const updated = await this.jobsStore.update(jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      platforms: current.platforms.map<PlatformRun>((item) =>
        item.platformId === platformId
          ? {
              ...item,
              errorMessage: undefined,
              retryAfter: undefined,
              captionText: socialMetadata.caption,
              hashtags: socialMetadata.hashtags,
              captionCacheKey,
              updatedAt: nowIso()
            }
          : item
      )
    }));

    if (!updated) {
      throw new Error("Job tidak ditemukan.");
    }

    const updatedPlatform = updated.platforms.find((item) => item.platformId === platformId);
    if (updatedPlatform) {
      await writeCaptionArtifactForPlatform(
        updatedPlatform,
        getEffectivePlatformMetadata(updated, updatedPlatform).affiliateLink
      );
    }

    return updated;
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
      try {
        await this.processItem(item);
      } catch (error) {
        this.logger.error({ err: error, jobId: item.jobId }, "Processing job gagal.");
      }
    }
    this.running = false;
    this.resolveIdle();
  }

  private async processItem(item: QueueItem): Promise<void> {
    const job = await this.jobsStore.ensureSourceVideo(item.jobId);
    if (!job) {
      return;
    }
    const settings = await this.settingsStore.get();
    const selectedPlatformIds =
      item.platformIds && item.platformIds.length
        ? item.platformIds
        : job.platforms.map((platform) => platform.platformId);

    await this.jobsStore.update(item.jobId, (current) => ({
      ...current,
      overallStatus: "running",
      updatedAt: nowIso()
    }));

    const requiresUploadedVideo = selectedPlatformIds.some((platformId) => {
      const platformSettings = findPlatformSettings(settings, platformId);
      if (!platformSettings?.enabled) {
        return false;
      }
      if (item.forceFresh) {
        return true;
      }
      const previousPlatform = job.platforms.find((platform) => platform.platformId === platformId);
      return this.needsFreshScript(job, settings, platformId, previousPlatform);
    });

    let uploadedVideo;
    if (requiresUploadedVideo) {
      try {
        uploadedVideo = await this.aiService.uploadVideo(
          job.videoPath,
          job.videoMimeType,
          settings.scriptModel
        );
      } catch (error) {
        const message = this.toErrorMessage(error);
        await this.markPlatformsFailed(
          item.jobId,
          selectedPlatformIds,
          message,
          buildRetryAfter(error)
        );
        return;
      }
    }

    let sourceVideoMetadata;
    try {
      sourceVideoMetadata = await probeVideoMetadata(job.videoPath);
    } catch (error) {
      const message = this.toErrorMessage(error);
      await this.markPlatformsFailed(
        item.jobId,
        selectedPlatformIds,
        message,
        buildRetryAfter(error)
      );
      return;
    }

    for (const platformId of selectedPlatformIds) {
      const platformSettings = findPlatformSettings(settings, platformId);
      if (!platformSettings?.enabled) {
        await this.jobsStore.update(item.jobId, (current) => ({
          ...current,
          updatedAt: nowIso(),
          platforms: current.platforms.map<PlatformRun>((platform) =>
            platform.platformId === platformId
              ? {
                  ...platform,
                  status: "failed",
                  errorMessage: "Platform dinonaktifkan di settings.",
                  updatedAt: nowIso()
                }
              : platform
          )
        }));
        continue;
      }

      await this.updatePlatform(item.jobId, platformId, "running");

      const attemptOutputPaths: string[] = [];
      const tempArtifactPaths: string[] = [];
      const previousPlatform = job.platforms.find((platform) => platform.platformId === platformId);
      const metadata = getEffectivePlatformMetadata(job, previousPlatform);
      try {
        const renderProfileId =
          previousPlatform?.renderProfileId ?? getRenderProfileIdForPlatform(platformId);
        const renderVariantKey =
          previousPlatform?.renderVariantKey ??
          pickRenderVariantKey(item.jobId, platformId, renderProfileId);
        let auditBoost = Boolean(previousPlatform?.visualAuditBoosted);
        if (
          previousPlatform?.renderProfileId !== renderProfileId ||
          previousPlatform?.renderVariantKey !== renderVariantKey
        ) {
          await this.patchPlatform(item.jobId, platformId, {
            renderProfileId,
            renderVariantKey
          });
        }

        const selectedCta = await this.resolveSelectedCta(
          item.jobId,
          platformId,
          previousPlatform,
          settings
        );
        const scriptPrompt = buildScriptPrompt({
          settings,
          platformId,
          title: metadata.title,
          description: metadata.description,
          videoDurationSec: job.videoDurationSec,
          ctaText: selectedCta.ctaText
        });
        const scriptCacheKey = buildScriptCacheKey(settings.scriptModel, scriptPrompt);
        const cachedScriptText =
          !item.forceFresh && previousPlatform?.scriptCacheKey === scriptCacheKey
            ? previousPlatform.scriptText
            : undefined;
        const scriptText =
          cachedScriptText ||
          (await this.aiService.generateScript({
            model: settings.scriptModel,
            prompt: scriptPrompt,
            video:
              uploadedVideo ?? {
                filename: path.basename(job.videoPath),
                mimeType: job.videoMimeType
              }
          }));

        if (!cachedScriptText) {
          await this.patchPlatform(item.jobId, platformId, {
            scriptText,
            scriptCacheKey
          });
        }

        const outputDir = path.join(OUTPUTS_DIR, platformId);
        await mkdir(outputDir, { recursive: true });

        const srtText = buildSrt(
          scriptText,
          job.videoDurationSec,
          PLATFORM_CONFIG[platformId].srtStyle
        );
        const buildCurrentRenderCacheKey = (nextAuditBoost: boolean) =>
          buildRenderCacheKey({
            sourceVideoPath: job.videoPath,
            sourceDurationSec: sourceVideoMetadata.durationSec,
            sourceWidth: sourceVideoMetadata.displayWidth,
            sourceHeight: sourceVideoMetadata.displayHeight,
            sourceRotation: sourceVideoMetadata.rotation,
            scriptText,
            title: metadata.title,
            description: metadata.description,
            ctaText: selectedCta.ctaText,
            renderProfileId,
            renderVariantKey,
            auditBoost: nextAuditBoost,
            rendererVersion: RENDERER_VERSION
          });
        let renderCacheKey = buildCurrentRenderCacheKey(auditBoost);
        const previousMp4Path = resolveOutputPath(previousPlatform?.mp4Path);
        const previousCaptionPath = resolveOutputPath(previousPlatform?.captionPath);
        const canReuseRenderedMedia =
          !item.forceFresh &&
          previousPlatform?.renderCacheKey === renderCacheKey &&
          previousMp4Path &&
          previousCaptionPath &&
          (await this.fileExists(previousMp4Path)) &&
          (await this.fileExists(previousCaptionPath));

        let mp4Path: string;
        let captionPath: string;
        let latestUrls: string[];
        if (canReuseRenderedMedia && previousPlatform?.mp4Path && previousPlatform.captionPath) {
          mp4Path = previousMp4Path!;
          captionPath = previousCaptionPath!;
          latestUrls = [
            previousPlatform.mp4Path,
            previousPlatform.captionPath ?? toOutputUrl(platformId, path.basename(captionPath))
          ];
        } else {
          const baseName = await resolveVersionedBaseName({
            directory: outputDir,
            preferredBaseName: metadata.title,
            suffixes: [".mp4", "-caption.txt", ".txt"]
          });
          const mp4Filename = `${baseName}.mp4`;
          const captionFilename = `${baseName}-caption.txt`;

          mp4Path = path.join(outputDir, mp4Filename);
          captionPath = path.join(outputDir, captionFilename);
          attemptOutputPaths.push(mp4Path, captionPath);
          latestUrls = [
            toOutputUrl(platformId, mp4Filename),
            toOutputUrl(platformId, captionFilename)
          ];
        }

        const fallbackSocial = {
          caption: fallbackCaption(metadata.title, metadata.description, selectedCta.ctaText),
          hashtags: fallbackHashtags(metadata.title, platformId)
        };
        const captionPrompt = buildReelsMetadataPrompt({
          title: metadata.title,
          description: metadata.description,
          platformId,
          scriptText,
          ctaText: selectedCta.ctaText
        });
        const captionCacheKey = buildCaptionCacheKey(settings.scriptModel, captionPrompt);
        const cachedSocialMetadata =
          !item.forceFresh &&
          previousPlatform?.captionCacheKey === captionCacheKey &&
          previousPlatform.captionText &&
          previousPlatform.hashtags?.length
            ? {
                caption: previousPlatform.captionText,
                hashtags: previousPlatform.hashtags
              }
            : undefined;
        const socialMetadata =
          cachedSocialMetadata ||
          (await (async (): Promise<SocialMetadata> => {
            try {
              const candidate = await this.aiService.generateSocialMetadata({
                model: settings.scriptModel,
                title: metadata.title,
                description: metadata.description,
                platformId,
                scriptText,
                ctaText: selectedCta.ctaText
              });
              return ensureSocialMetadata(
                candidate,
                fallbackSocial.caption,
                fallbackSocial.hashtags
              );
            } catch (error) {
              this.logger.warn(
                { err: error, jobId: item.jobId, platformId },
                "Generate caption/hashtags gagal, pakai fallback."
              );
              return fallbackSocial;
            }
          })());

        if (!cachedSocialMetadata) {
          await this.patchPlatform(item.jobId, platformId, {
            captionText: socialMetadata.caption,
            hashtags: socialMetadata.hashtags,
            captionCacheKey
          });
        }
        const captionFileParts = [
          socialMetadata.caption,
          socialMetadata.hashtags.join(" "),
          metadata.affiliateLink
        ].filter((part) => part.length > 0);
        await writeFile(captionPath, `${captionFileParts.join("\n\n")}\n`, "utf8");

        const tempWavPath = path.join(path.dirname(job.videoPath), `${platformId}-tts.wav`);
        const ttsCacheKey = buildTtsCacheKey({
          model: settings.ttsModel,
          text: scriptText,
          voiceName: platformSettings.voiceName,
          speechRate: platformSettings.speechRate
        });
        const canReuseAudio =
          !item.forceFresh &&
          previousPlatform?.ttsCacheKey === ttsCacheKey &&
          (await this.fileExists(tempWavPath));

        if (!canReuseAudio) {
          const audio = await this.speechGenerator.generateSpeech({
            model: settings.ttsModel,
            text: scriptText,
            voiceName: platformSettings.voiceName,
            speechRate: platformSettings.speechRate
          });
          await writeWav24kMono(
            audio.data,
            audio.mimeType,
            tempWavPath,
            platformSettings.speechRate
          );
          await this.patchPlatform(item.jobId, platformId, {
            ttsCacheKey
          });
        }

        let visualAuditStatus: VisualAuditStatus =
          previousPlatform?.visualAuditStatus ?? "skipped";
        let visualAuditScore = previousPlatform?.visualAuditScore;
        const renderCurrentPlatform = async (nextAuditBoost: boolean) => {
          const tempSrtPath = path.join(
            path.dirname(job.videoPath),
            `${platformId}-render-subtitles.srt`
          );
          if (!tempArtifactPaths.includes(tempSrtPath)) {
            tempArtifactPaths.push(tempSrtPath);
          }
          auditBoost = nextAuditBoost;
          renderCacheKey = buildCurrentRenderCacheKey(auditBoost);
          await writeFile(tempSrtPath, srtText, "utf8");
          await renderPlatformVideo({
            sourceVideoPath: job.videoPath,
            voiceWavPath: tempWavPath,
            subtitlePath: tempSrtPath,
            outputVideoPath: mp4Path,
            targetDurationSec: job.videoDurationSec,
            videoMetadata: sourceVideoMetadata,
            renderProfileId,
            renderVariantKey,
            auditBoost,
            titleText: metadata.title,
            ctaText: selectedCta.ctaText
          });
        };

        if (!canReuseRenderedMedia) {
          await renderCurrentPlatform(auditBoost);
          const auditResult = await this.auditPlatformVisualOutput(
            item.jobId,
            platformId,
            mp4Path
          );
          visualAuditStatus = auditResult.status;
          visualAuditScore = auditResult.score;
          if (
            auditResult.status === "failed" &&
            platformId !== VISUAL_AUDIT_REFERENCE_PLATFORM &&
            !auditBoost
          ) {
            await renderCurrentPlatform(true);
            const boostedAuditResult = await this.auditPlatformVisualOutput(
              item.jobId,
              platformId,
              mp4Path
            );
            visualAuditStatus =
              boostedAuditResult.status === "passed" ? "boosted" : boostedAuditResult.status;
            visualAuditScore = boostedAuditResult.score;
            if (boostedAuditResult.status === "failed") {
              await this.patchPlatform(item.jobId, platformId, {
                visualAuditScore,
                visualAuditStatus: "failed",
                visualAuditBoosted: true,
                renderCacheKey
              });
              throw new Error(boostedAuditResult.message ?? "Audit visual platform gagal.");
            }
          } else if (auditResult.status === "failed") {
            await this.patchPlatform(item.jobId, platformId, {
              visualAuditScore,
              visualAuditStatus: "failed",
              visualAuditBoosted: auditBoost,
              renderCacheKey
            });
            throw new Error(auditResult.message ?? "Audit visual platform gagal.");
          }
        }

        const obsoleteOutputPaths = listObsoletePlatformArtifactPaths(previousPlatform, latestUrls);
        if (obsoleteOutputPaths.length > 0) {
          try {
            await Promise.all(
              obsoleteOutputPaths.map((outputPath) =>
                rm(outputPath, { recursive: false, force: true })
              )
            );
          } catch (cleanupError) {
            this.logger.warn(
              { err: cleanupError, jobId: item.jobId, platformId },
              "Gagal membersihkan output lama platform."
            );
          }
        }

        await this.jobsStore.update(item.jobId, (current) => ({
          ...current,
          updatedAt: nowIso(),
          platforms: current.platforms.map<PlatformRun>((platform) =>
            platform.platformId === platformId
              ? {
                  ...platform,
                  status: "done",
                  errorMessage: undefined,
                  retryAfter: undefined,
                  scriptPath: undefined,
                  srtPath: undefined,
                  mp4Path: latestUrls[0],
                  captionPath: latestUrls[1],
                  captionText: socialMetadata.caption,
                  hashtags: socialMetadata.hashtags,
                  renderProfileId,
                  renderVariantKey,
                  renderCacheKey,
                  visualAuditScore,
                  visualAuditStatus,
                  visualAuditBoosted: auditBoost,
                  artifactPaths: latestUrls,
                  updatedAt: nowIso()
                }
              : platform
          )
        }));
        this.logger.info(
          { jobId: item.jobId, platform: platformId },
          `Platform ${PLATFORM_LABELS[platformId]} selesai.`
        );
      } catch (error) {
        await Promise.all(
          [...new Set([...attemptOutputPaths, ...tempArtifactPaths])].map((outputPath) =>
            rm(outputPath, { recursive: false, force: true })
          )
        );
        await this.updatePlatform(
          item.jobId,
          platformId,
          "failed",
          this.toErrorMessage(error),
          buildRetryAfter(error)
        );
        this.logger.error(
          { err: error, jobId: item.jobId, platformId },
          "Platform processing gagal."
        );
      } finally {
        if (tempArtifactPaths.length > 0) {
          try {
            await Promise.all(
              tempArtifactPaths.map((outputPath) =>
                rm(outputPath, { recursive: false, force: true })
              )
            );
          } catch (cleanupError) {
            this.logger.warn(
              { err: cleanupError, jobId: item.jobId, platformId },
              "Gagal membersihkan subtitle sementara platform."
            );
          }
        }
      }
    }

    await this.jobsStore.update(item.jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      overallStatus: JobsStore.computeOverallStatus(current.platforms)
    }));
  }

  private async auditPlatformVisualOutput(
    jobId: string,
    platformId: PlatformId,
    mp4Path: string
  ): Promise<VisualAuditResult> {
    if (platformId === VISUAL_AUDIT_REFERENCE_PLATFORM) {
      return { status: "skipped" };
    }

    const latestJob = await this.jobsStore.getById(jobId);
    const comparisonPlatforms =
      latestJob?.platforms.filter(
        (platform) =>
          platform.platformId !== platformId &&
          platform.status === "done" &&
          Boolean(platform.mp4Path)
      ) ?? [];

    let checkedCount = 0;
    let minScore: number | undefined;
    const failures: string[] = [];

    for (const comparisonPlatform of comparisonPlatforms) {
      const comparisonPath = resolveOutputPath(comparisonPlatform.mp4Path);
      if (!comparisonPath || !(await this.fileExists(comparisonPath))) {
        continue;
      }

      const result = await compareVideoVisualDifference(mp4Path, comparisonPath);
      checkedCount += 1;
      minScore = minScore === undefined ? result.score : Math.min(minScore, result.score);
      const threshold =
        comparisonPlatform.platformId === VISUAL_AUDIT_REFERENCE_PLATFORM
          ? VISUAL_AUDIT_TIKTOK_MIN_SCORE
          : VISUAL_AUDIT_NON_TIKTOK_MIN_SCORE;
      if (result.score < threshold) {
        failures.push(
          `${PLATFORM_LABELS[platformId]} vs ${PLATFORM_LABELS[comparisonPlatform.platformId]} ${result.score.toFixed(
            2
          )}/${threshold.toFixed(2)}`
        );
      }
    }

    if (checkedCount === 0) {
      return { status: "skipped" };
    }
    if (failures.length > 0) {
      return {
        status: "failed",
        score: minScore,
        message: `Audit visual gagal: perbedaan visual terlalu rendah (${failures.join(", ")}).`
      };
    }

    return {
      status: "passed",
      score: minScore
    };
  }

  private async markPlatformsFailed(
    jobId: string,
    platformIds: PlatformId[],
    message: string,
    retryAfter?: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextPlatforms = current.platforms.map<PlatformRun>((platform) =>
        platformIds.includes(platform.platformId)
          ? {
              ...platform,
              status: "failed",
              errorMessage: message,
              retryAfter,
              updatedAt: nowIso()
            }
          : platform
      );
      return {
        ...current,
        updatedAt: nowIso(),
        platforms: nextPlatforms,
        overallStatus: JobsStore.computeOverallStatus(nextPlatforms)
      };
    });
  }

  private async updatePlatform(
    jobId: string,
    platformId: PlatformId,
    status: JobRecord["platforms"][number]["status"],
    errorMessage?: string,
    retryAfter?: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextPlatforms = current.platforms.map<PlatformRun>((platform) =>
        platform.platformId === platformId
          ? {
              ...platform,
              status,
              errorMessage,
              retryAfter: status === "failed" || status === "interrupted" ? retryAfter : undefined,
              updatedAt: nowIso()
            }
          : platform
      );
      return {
        ...current,
        updatedAt: nowIso(),
        platforms: nextPlatforms,
        overallStatus: JobsStore.computeOverallStatus(nextPlatforms)
      };
    });
  }

  private toErrorMessage(error: unknown): string {
    if (isRateLimitError(error)) {
      return `${buildRateLimitErrorMessage(error)} Cek quota/key SnifoxAI Anda atau tunggu reset limit.`;
    }
    return extractErrorMessage(error);
  }

  private async patchPlatform(
    jobId: string,
    platformId: PlatformId,
    patch: Partial<PlatformRun>
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      platforms: current.platforms.map<PlatformRun>((platform) =>
        platform.platformId === platformId
          ? {
              ...platform,
              ...patch,
              updatedAt: nowIso()
            }
          : platform
      )
    }));
  }

  private async resolveSelectedCta(
    jobId: string,
    platformId: PlatformId,
    previousPlatform: PlatformRun | undefined,
    settings: AppSettings
  ): Promise<SelectedCtaState> {
    if (previousPlatform?.selectedCtaText?.trim()) {
      return {
        ctaMode: settings.ctaMode,
        ctaText: previousPlatform.selectedCtaText,
        ctaIndex: previousPlatform.selectedCtaIndex ?? 0
      };
    }

    const selected = await this.settingsStore.pickCta(platformId);
    await this.patchPlatform(jobId, platformId, {
      selectedCtaText: selected.ctaText,
      selectedCtaIndex: selected.ctaIndex
    });
    return selected;
  }

  private needsFreshScript(
    job: JobRecord,
    settings: AppSettings,
    platformId: PlatformId,
    platform: PlatformRun | undefined
  ): boolean {
    if (!platform?.scriptText || !platform.selectedCtaText || !platform.scriptCacheKey) {
      return true;
    }

    const metadata = getEffectivePlatformMetadata(job, platform);
    const prompt = buildScriptPrompt({
      settings,
      platformId,
      title: metadata.title,
      description: metadata.description,
      videoDurationSec: job.videoDurationSec,
      ctaText: platform.selectedCtaText
    });
    return platform.scriptCacheKey !== buildScriptCacheKey(settings.scriptModel, prompt);
  }

  private async fileExists(filePath: string): Promise<boolean> {
    try {
      await access(filePath);
      return true;
    } catch {
      return false;
    }
  }
}
