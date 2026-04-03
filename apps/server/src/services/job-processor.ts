import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FastifyBaseLogger } from "fastify";
import type { AppSettings, JobRecord, PlatformId, PlatformRun } from "../types.js";
import { PLATFORM_CONFIG, PLATFORM_LABELS } from "../platform-config.js";
import { JobsStore } from "../stores/jobs-store.js";
import { SettingsStore } from "../stores/settings-store.js";
import { buildScriptPrompt } from "./prompt-builder.js";
import { GeminiService } from "./gemini-service.js";
import { OUTPUTS_DIR } from "../utils/paths.js";
import { buildSrt } from "../utils/srt.js";
import { combineVideoWithVoiceOver, writeWav24kMono } from "../utils/audio.js";
import { ensureSocialMetadata } from "../utils/model-output.js";
import { resolveVersionedBaseName } from "../utils/filename.js";

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

function fallbackCaption(title: string, description: string): string {
  const shortDescription = description.split(".")[0]?.trim() || description.trim();
  return `${title} - ${shortDescription}. Cek detail produk di keranjang sekarang.`
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

function parseGeminiQuotaMessage(message: string): string | undefined {
  try {
    const payload = JSON.parse(message) as {
      error?: {
        code?: number;
        status?: string;
        details?: Array<Record<string, unknown>>;
      };
    };
    const status = payload.error?.status || "";
    const code = payload.error?.code || 0;
    if (!(status === "RESOURCE_EXHAUSTED" || code === 429)) {
      return undefined;
    }

    let retryDelay = "";
    for (const detail of payload.error?.details || []) {
      const detailType = String(detail["@type"] || "");
      if (detailType.includes("RetryInfo")) {
        retryDelay = String(detail["retryDelay"] || "").trim();
      }
    }

    const retryText = retryDelay ? ` Coba lagi dalam ${retryDelay}.` : "";
    return `Kuota Gemini habis untuk saat ini.${retryText} Cek billing/quota API key Anda atau tunggu reset kuota.`;
  } catch {
    return undefined;
  }
}

function toOutputUrl(platformId: PlatformId, filename: string): string {
  return `/outputs/${platformId}/${encodeURIComponent(filename)}`;
}

function mergeArtifactPaths(current: string[], latest: string[]): string[] {
  return [...new Set([...current, ...latest])];
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
    private readonly gemini: GeminiService,
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
      uploadedVideo = await this.gemini.uploadVideo(job.videoPath, job.videoMimeType);
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
      try {
        const scriptPrompt = buildScriptPrompt({
          settings,
          platformId,
          title: job.title,
          description: job.description,
          videoDurationSec: job.videoDurationSec
        });
        const scriptText = await this.gemini.generateScript({
          model: settings.scriptModel,
          prompt: scriptPrompt,
          video: uploadedVideo
        });

        const outputDir = path.join(OUTPUTS_DIR, platformId);
        await mkdir(outputDir, { recursive: true });

        const baseName = await resolveVersionedBaseName({
          directory: outputDir,
          preferredBaseName: job.title,
          suffixes: [".mp4", ".srt", ".txt", "-caption.txt"]
        });
        const scriptFilename = `${baseName}.txt`;
        const srtFilename = `${baseName}.srt`;
        const mp4Filename = `${baseName}.mp4`;
        const captionFilename = `${baseName}-caption.txt`;

        const scriptPath = path.join(outputDir, scriptFilename);
        const srtPath = path.join(outputDir, srtFilename);
        const mp4Path = path.join(outputDir, mp4Filename);
        const captionPath = path.join(outputDir, captionFilename);
        attemptOutputPaths.push(scriptPath, srtPath, mp4Path, captionPath);

        await writeFile(scriptPath, `${scriptText.trim()}\n`, "utf8");
        const srtContent = buildSrt(
          scriptText,
          job.videoDurationSec,
          PLATFORM_CONFIG[platformId].srtStyle
        );
        await writeFile(srtPath, srtContent, "utf8");

        const fallbackSocial = {
          caption: fallbackCaption(job.title, job.description),
          hashtags: fallbackHashtags(job.title, platformId)
        };
        const socialMetadata = await (async () => {
          try {
            const candidate = await this.gemini.generateSocialMetadata({
              model: settings.scriptModel,
              title: job.title,
              description: job.description,
              platformId,
              scriptText
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
        const audio = await this.gemini.generateSpeech({
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
          toOutputUrl(platformId, scriptFilename),
          toOutputUrl(platformId, srtFilename),
          toOutputUrl(platformId, mp4Filename),
          toOutputUrl(platformId, captionFilename)
        ];

        await this.jobsStore.update(item.jobId, (current) => ({
          ...current,
          updatedAt: nowIso(),
          platforms: current.platforms.map<PlatformRun>((platform) =>
            platform.platformId === platformId
              ? {
                  ...platform,
                  status: "done",
                  errorMessage: undefined,
                  scriptPath: latestUrls[0],
                  srtPath: latestUrls[1],
                  mp4Path: latestUrls[2],
                  captionPath: latestUrls[3],
                  captionText: socialMetadata.caption,
                  hashtags: socialMetadata.hashtags,
                  artifactPaths: mergeArtifactPaths(platform.artifactPaths, latestUrls),
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
    const message = (error as { message?: string })?.message || "Error tidak diketahui.";
    const quotaMessage = parseGeminiQuotaMessage(message);
    if (quotaMessage) {
      return quotaMessage;
    }
    return message;
  }
}
