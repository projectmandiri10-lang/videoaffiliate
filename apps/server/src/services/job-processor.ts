import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type {
  AIService,
  AppSettings,
  JobRecord,
  PlatformId,
  PlatformRun,
  SpeechGenerator
} from "../types.js";
import { PLATFORM_LABELS } from "../platform-config.js";
import { JobsStore } from "../stores/jobs-store.js";
import { SettingsStore } from "../stores/settings-store.js";
import { buildScriptPrompt } from "./prompt-builder.js";
import { OUTPUTS_DIR, outputUrlToAbsolutePath } from "../utils/paths.js";
import { combineVideoWithVoiceOver, writeWav24kMono } from "../utils/audio.js";
import { formatCtaAsSentence } from "../utils/cta.js";
import { ensureSocialMetadata } from "../utils/model-output.js";
import { resolveVersionedBaseName } from "../utils/filename.js";
import {
  buildRateLimitErrorMessage,
  extractErrorMessage,
  isRateLimitError
} from "../utils/llm-error.js";

interface QueueItem {
  jobId: string;
  platformIds?: PlatformId[];
}

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

function toOutputUrl(platformId: PlatformId, filename: string): string {
  return `/outputs/${platformId}/${encodeURIComponent(filename)}`;
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
  enqueue(jobId: string, platformIds?: PlatformId[]): void;
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

  public enqueue(jobId: string, platformIds?: PlatformId[]): void {
    this.queue.push({ jobId, platformIds });
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
    const job = await this.jobsStore.getById(item.jobId);
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

    let uploadedVideo;
    try {
      uploadedVideo = await this.aiService.uploadVideo(
        job.videoPath,
        job.videoMimeType,
        settings.scriptModel
      );
    } catch (error) {
      const message = this.toErrorMessage(error);
      await this.markPlatformsFailed(item.jobId, selectedPlatformIds, message);
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
      const previousPlatform = job.platforms.find((platform) => platform.platformId === platformId);
      try {
        const selectedCta = await this.settingsStore.pickCta(platformId);
        const scriptPrompt = buildScriptPrompt({
          settings,
          platformId,
          title: job.title,
          description: job.description,
          videoDurationSec: job.videoDurationSec,
          ctaText: selectedCta.ctaText
        });
        const scriptText = await this.aiService.generateScript({
          model: settings.scriptModel,
          prompt: scriptPrompt,
          video: uploadedVideo
        });

        const outputDir = path.join(OUTPUTS_DIR, platformId);
        await mkdir(outputDir, { recursive: true });

        const baseName = await resolveVersionedBaseName({
          directory: outputDir,
          preferredBaseName: job.title,
          suffixes: [".mp4", "-caption.txt", ".srt", ".txt"]
        });
        const mp4Filename = `${baseName}.mp4`;
        const captionFilename = `${baseName}-caption.txt`;

        const mp4Path = path.join(outputDir, mp4Filename);
        const captionPath = path.join(outputDir, captionFilename);
        attemptOutputPaths.push(mp4Path, captionPath);

        const fallbackSocial = {
          caption: fallbackCaption(job.title, job.description, selectedCta.ctaText),
          hashtags: fallbackHashtags(job.title, platformId)
        };
        const socialMetadata = await (async () => {
          try {
            const candidate = await this.aiService.generateSocialMetadata({
              model: settings.scriptModel,
              title: job.title,
              description: job.description,
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
        })();
        const captionFileParts = [
          socialMetadata.caption,
          socialMetadata.hashtags.join(" "),
          job.affiliateLink?.trim() || ""
        ].filter((part) => part.length > 0);
        await writeFile(captionPath, `${captionFileParts.join("\n\n")}\n`, "utf8");

        const tempWavPath = path.join(path.dirname(job.videoPath), `${platformId}-tts.wav`);
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
        await combineVideoWithVoiceOver(
          job.videoPath,
          tempWavPath,
          mp4Path,
          job.videoDurationSec
        );

        const latestUrls = [
          toOutputUrl(platformId, mp4Filename),
          toOutputUrl(platformId, captionFilename)
        ];

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
                  scriptPath: undefined,
                  srtPath: undefined,
                  mp4Path: latestUrls[0],
                  captionPath: latestUrls[1],
                  captionText: socialMetadata.caption,
                  hashtags: socialMetadata.hashtags,
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
          attemptOutputPaths.map((outputPath) => rm(outputPath, { recursive: false, force: true }))
        );
        await this.updatePlatform(item.jobId, platformId, "failed", this.toErrorMessage(error));
        this.logger.error(
          { err: error, jobId: item.jobId, platformId },
          "Platform processing gagal."
        );
      }
    }

    await this.jobsStore.update(item.jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      overallStatus: JobsStore.computeOverallStatus(current.platforms)
    }));
  }

  private async markPlatformsFailed(
    jobId: string,
    platformIds: PlatformId[],
    message: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextPlatforms = current.platforms.map<PlatformRun>((platform) =>
        platformIds.includes(platform.platformId)
          ? {
              ...platform,
              status: "failed",
              errorMessage: message,
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
    errorMessage?: string
  ): Promise<void> {
    await this.jobsStore.update(jobId, (current) => {
      const nextPlatforms = current.platforms.map<PlatformRun>((platform) =>
        platform.platformId === platformId
          ? {
              ...platform,
              status,
              errorMessage,
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
}
