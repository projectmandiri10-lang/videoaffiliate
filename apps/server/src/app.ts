import cors from "@fastify/cors";
import multipart, { type MultipartFile } from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply
} from "fastify";
import { createWriteStream } from "node:fs";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { nanoid } from "nanoid";
import {
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES,
  MAX_UPLOAD_BYTES,
  PLATFORM_ORDER,
  findTtsVoiceByName
} from "./constants.js";
import { JobsStore } from "./stores/jobs-store.js";
import { SettingsStore } from "./stores/settings-store.js";
import type { GenerateSpeechInput, JobRecord, PlatformId } from "./types.js";
import {
  parseJobUpdateInput,
  parseRetryPlatformId,
  parseSettings,
  parseTtsPreviewInput
} from "./validation.js";
import {
  OUTPUTS_DIR,
  UPLOADS_DIR,
  WEB_DIST_DIR,
  outputUrlToAbsolutePath
} from "./utils/paths.js";
import { probeVideoDuration } from "./utils/video.js";
import type { IJobProcessor } from "./services/job-processor.js";
import { openPathInExplorer } from "./utils/open-location.js";
import { writeWav24kMono } from "./utils/audio.js";
import { normalizeApiError } from "./utils/api-error.js";
import { pruneVoicePreviewFiles } from "./utils/voice-preview.js";

interface BuildAppOptions {
  logger: FastifyBaseLogger;
  webOrigins: string[];
  settingsStore: SettingsStore;
  jobsStore: JobsStore;
  processor: IJobProcessor;
  speechGenerator?: {
    generateSpeech: (
      input: GenerateSpeechInput
    ) => Promise<{ data: Buffer; mimeType: string }>;
  };
  probeDuration?: (videoPath: string) => Promise<number>;
  openOutputLocation?: (folderPath: string) => Promise<void>;
  writePreviewAudio?: typeof writeWav24kMono;
  pruneVoicePreviews?: (previewDir: string) => Promise<void>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function createPlatformRuns(platformIds: PlatformId[]): JobRecord["platforms"] {
  return platformIds.map((platformId) => ({
    platformId,
    status: "pending",
    artifactPaths: [],
    updatedAt: nowIso()
  }));
}

function pickVideoExtension(part: MultipartFile): string {
  const fromName = path.extname(part.filename || "").trim();
  if (fromName) {
    return fromName;
  }
  const fromMime = mime.extension(part.mimetype || "");
  return fromMime ? `.${fromMime}` : ".mp4";
}

function sendNormalizedError(reply: FastifyReply, error: unknown, message: string) {
  const normalized = normalizeApiError(error);
  return reply.code(normalized.statusCode).send({
    message,
    error: normalized.error
  });
}

function isJobEditable(job: JobRecord): boolean {
  return ["queued", "failed", "interrupted"].includes(job.overallStatus);
}

function isJobDeletable(job: JobRecord): boolean {
  return job.overallStatus !== "running";
}

function resolvePlatformFolderPath(
  job: JobRecord,
  platformId: PlatformId
): string {
  const platform = job.platforms.find((item) => item.platformId === platformId);
  const latestOutput = [
    platform?.mp4Path,
    platform?.scriptPath,
    platform?.srtPath,
    platform?.captionPath
  ].find(Boolean);
  const absoluteOutput = latestOutput ? outputUrlToAbsolutePath(latestOutput) : undefined;
  return absoluteOutput ? path.dirname(absoluteOutput) : path.join(OUTPUTS_DIR, platformId);
}

function getRetryCooldownRemainingMs(retryAfter?: string): number {
  if (!retryAfter) {
    return 0;
  }
  const retryAtMs = Date.parse(retryAfter);
  if (!Number.isFinite(retryAtMs)) {
    return 0;
  }
  return Math.max(0, retryAtMs - Date.now());
}

function formatRetryCooldown(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds < 60) {
    return `${totalSeconds} detik`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes} menit` : `${minutes} menit ${seconds} detik`;
}

function clearRetryablePlatformState(
  platform: JobRecord["platforms"][number]
): JobRecord["platforms"][number] {
  return {
    ...platform,
    retryAfter: undefined,
    scriptPath: undefined,
    srtPath: undefined,
    mp4Path: undefined,
    captionPath: undefined,
    captionText: undefined,
    hashtags: undefined,
    scriptText: undefined,
    selectedCtaText: undefined,
    selectedCtaIndex: undefined,
    scriptCacheKey: undefined,
    captionCacheKey: undefined,
    ttsCacheKey: undefined,
    artifactPaths: [],
    updatedAt: nowIso()
  };
}

async function maybeRegisterWebStatic(app: FastifyInstance): Promise<void> {
  try {
    await access(WEB_DIST_DIR);
  } catch {
    return;
  }
  const indexHtml = await readFile(path.join(WEB_DIST_DIR, "index.html"), "utf8");

  await app.register(fastifyStatic, {
    root: WEB_DIST_DIR,
    wildcard: false,
    prefix: "/",
    decorateReply: false
  });

  app.get("/*", async (request, reply) => {
    if (request.url.startsWith("/api") || request.url.startsWith("/outputs")) {
      return reply.code(404).send({ message: "Not found" });
    }
    reply.type("text/html; charset=utf-8");
    return reply.send(indexHtml);
  });
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ loggerInstance: options.logger });
  const durationProbe = options.probeDuration ?? probeVideoDuration;
  const openOutputLocation = options.openOutputLocation ?? openPathInExplorer;
  const writePreviewAudio = options.writePreviewAudio ?? writeWav24kMono;
  const pruneVoicePreviews =
    options.pruneVoicePreviews ??
    ((previewDir: string) =>
      pruneVoicePreviewFiles(previewDir, {
        logger: options.logger
      }));

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, options.webOrigins.includes(origin));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"]
  });
  await app.register(multipart, {
    limits: {
      fileSize: MAX_UPLOAD_BYTES,
      files: 1
    }
  });
  await app.register(fastifyStatic, {
    root: OUTPUTS_DIR,
    prefix: "/outputs/"
  });
  await maybeRegisterWebStatic(app);

  app.setErrorHandler((error, request, reply) => {
    request.log.error({ err: error }, "Unhandled API error.");
    return sendNormalizedError(reply, error, "Terjadi kesalahan pada server.");
  });

  app.get("/api/health", async () => ({
    status: "ok",
    now: nowIso()
  }));

  app.get("/api/settings", async (_request, reply) => {
    try {
      return await options.settingsStore.get();
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat settings.");
    }
  });

  app.put("/api/settings", async (request, reply) => {
    let parsed;
    try {
      parsed = parseSettings(request.body);
    } catch (error) {
      return sendNormalizedError(reply, error, "Settings tidak valid.");
    }

    try {
      await options.settingsStore.set(parsed);
      return reply.send(parsed);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal menyimpan settings.");
    }
  });

  app.get("/api/tts/voices", async () => {
    return {
      voices: GEMINI_TTS_VOICES,
      excitedPresets: GEMINI_EXCITED_PRESETS
    };
  });

  app.post("/api/tts/preview", async (request, reply) => {
    if (!options.speechGenerator) {
      return reply.code(503).send({
        message: "Speech generator tidak tersedia di server."
      });
    }

    let payload;
    try {
      payload = parseTtsPreviewInput(request.body);
    } catch (error) {
      return sendNormalizedError(reply, error, "Input preview voice tidak valid.");
    }

    const voice = findTtsVoiceByName(payload.voiceName);
    if (!voice) {
      return reply.code(400).send({
        message: `Voice ${payload.voiceName} tidak tersedia pada katalog Gemini.`
      });
    }

    try {
      const settings = await options.settingsStore.get();
      const sampleText =
        payload.text ||
        "Ini contoh voice over excited untuk video affiliate. Cek detail produk di komentar dan deskripsi.";
      const audio = await options.speechGenerator.generateSpeech({
        model: settings.ttsModel,
        text: sampleText,
        voiceName: voice.voiceName,
        speechRate: payload.speechRate
      });

      const previewDir = path.join(OUTPUTS_DIR, "_voice_previews");
      await mkdir(previewDir, { recursive: true });
      await pruneVoicePreviews(previewDir).catch((error) => {
        options.logger.warn({ err: error, previewDir }, "Gagal prune preview voice lama.");
      });
      const filename = `${Date.now()}-${voice.voiceName}-${nanoid(5)}.wav`;
      const outputPath = path.join(previewDir, filename);
      await writePreviewAudio(audio.data, audio.mimeType, outputPath, payload.speechRate);

      return reply.send({
        voiceName: voice.voiceName,
        previewPath: `/outputs/_voice_previews/${filename}`
      });
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal membuat preview voice.");
    }
  });

  app.get("/api/jobs", async (_request, reply) => {
    try {
      return await options.jobsStore.list();
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat daftar job.");
    }
  });

  app.get("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    let job;
    try {
      job = await options.jobsStore.getById(params.jobId);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat detail job.");
    }
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    return job;
  });

  app.put("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    let job;
    try {
      job = await options.jobsStore.getById(params.jobId);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat job.");
    }
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (!isJobEditable(job)) {
      return reply.code(409).send({
        message: "Job hanya bisa diedit saat status queued, failed, atau interrupted."
      });
    }

    let payload;
    try {
      payload = parseJobUpdateInput(request.body);
    } catch (error) {
      return sendNormalizedError(reply, error, "Data job tidak valid.");
    }

    try {
      const updated = await options.jobsStore.update(params.jobId, (current) => ({
        ...current,
        title: payload.title,
        description: payload.description,
        affiliateLink: payload.affiliateLink,
        updatedAt: nowIso(),
        platforms: current.platforms.map((platform) =>
          platform.status === "done" ? platform : clearRetryablePlatformState(platform)
        )
      }));

      if (!updated) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }

      return reply.send(updated);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memperbarui job.");
    }
  });

  app.delete("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    let job;
    try {
      job = await options.jobsStore.getById(params.jobId);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat job.");
    }
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (!isJobDeletable(job)) {
      return reply.code(409).send({
        message: "Job dengan status running tidak bisa dihapus."
      });
    }

    try {
      const removed = await options.jobsStore.delete(params.jobId);
      if (!removed) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }
      return reply.send({ ok: true });
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal menghapus job.");
    }
  });

  app.post("/api/jobs/:jobId/retry", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }

    let platformId: PlatformId;
    try {
      platformId = parseRetryPlatformId(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: "platformId tidak valid.",
        error: (error as { message?: string })?.message
      });
    }

    const platform = job.platforms.find((item) => item.platformId === platformId);
    if (!platform) {
      return reply.code(404).send({ message: "Platform pada job tidak ditemukan." });
    }
    if (!["failed", "interrupted"].includes(platform.status)) {
      return reply.code(400).send({
        message: "Retry hanya untuk platform dengan status failed/interrupted."
      });
    }
    const remainingCooldownMs = getRetryCooldownRemainingMs(platform.retryAfter);
    if (remainingCooldownMs > 0) {
      return reply
        .code(429)
        .header("Retry-After", String(Math.ceil(remainingCooldownMs / 1000)))
        .send({
          message: "Retry masih cooldown.",
          error: `Coba lagi dalam ${formatRetryCooldown(remainingCooldownMs)}.`
        });
    }

    await options.jobsStore.update(params.jobId, (current) => ({
      ...current,
      updatedAt: nowIso(),
      overallStatus: "queued",
      platforms: current.platforms.map((item) =>
        item.platformId === platformId
          ? {
              ...item,
              status: "pending",
              errorMessage: undefined,
              retryAfter: undefined,
              updatedAt: nowIso()
            }
          : item
      )
    }));

    options.processor.enqueue(params.jobId, [platformId]);
    return reply.send({ ok: true });
  });

  app.post("/api/jobs/:jobId/open-location", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }

    let platformId: PlatformId;
    try {
      platformId = parseRetryPlatformId(request.body);
    } catch (error) {
      return reply.code(400).send({
        message: "platformId tidak valid.",
        error: (error as { message?: string })?.message
      });
    }

    const platform = job.platforms.find((item) => item.platformId === platformId);
    if (!platform) {
      return reply.code(404).send({ message: "Platform pada job tidak ditemukan." });
    }

    const outputDir = resolvePlatformFolderPath(job, platformId);
    try {
      await mkdir(outputDir, { recursive: true });
      await openOutputLocation(outputDir);
      return reply.send({ ok: true, folderPath: outputDir });
    } catch (error) {
      return reply.code(500).send({
        message: "Gagal membuka lokasi file.",
        error: (error as { message?: string })?.message
      });
    }
  });

  app.post("/api/jobs", async (request, reply) => {
    const parts = (
      request as unknown as {
        parts: () => AsyncIterable<MultipartFile | any>;
      }
    ).parts();
    let title = "";
    let description = "";
    let affiliateLink = "";
    let videoPath = "";
    let videoMimeType = "video/mp4";
    let uploadDir = "";
    const jobId = nanoid(10);
    let keepUploadDir = false;

    const cleanupUploadDir = async () => {
      if (!uploadDir) {
        return;
      }
      const currentUploadDir = uploadDir;
      uploadDir = "";
      await rm(currentUploadDir, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 50
      });
    };

    try {
      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "video") {
          uploadDir = path.join(UPLOADS_DIR, jobId);
          await mkdir(uploadDir, { recursive: true });
          const extension = pickVideoExtension(part);
          videoPath = path.join(uploadDir, `source${extension}`);
          videoMimeType = part.mimetype || "video/mp4";
          await pipeline(part.file, createWriteStream(videoPath));
          continue;
        }
        if (part.type === "field" && part.fieldname === "title") {
          title = String(part.value || "").trim();
        }
        if (part.type === "field" && part.fieldname === "description") {
          description = String(part.value || "").trim();
        }
        if (part.type === "field" && part.fieldname === "affiliateLink") {
          affiliateLink = String(part.value || "").trim();
        }
        if (part.type === "file") {
          part.file.resume();
        }
      }

      if (!videoPath) {
        return reply.code(400).send({ message: "File video wajib diisi." });
      }
      if (!title || !description || !affiliateLink) {
        return reply
          .code(400)
          .send({ message: "Field title, description, dan affiliateLink wajib diisi." });
      }

      const settings = await options.settingsStore.get();
      const durationSec = await durationProbe(videoPath);
      if (durationSec > settings.maxVideoSeconds) {
        return reply.code(400).send({
          message: `Durasi video ${durationSec.toFixed(2)}s melebihi batas ${settings.maxVideoSeconds}s.`
        });
      }

      const now = nowIso();
      const job: JobRecord = {
        jobId,
        createdAt: now,
        updatedAt: now,
        title,
        description,
        affiliateLink,
        videoPath,
        videoMimeType,
        videoDurationSec: durationSec,
        overallStatus: "queued",
        platforms: createPlatformRuns(PLATFORM_ORDER)
      };
      await options.jobsStore.create(job);
      keepUploadDir = true;
      options.processor.enqueue(jobId, PLATFORM_ORDER);

      return reply.code(202).send({
        jobId,
        status: "queued"
      });
    } catch (error) {
      if (!keepUploadDir) {
        await cleanupUploadDir();
      }
      return sendNormalizedError(reply, error, "Gagal memproses upload video.");
    } finally {
      if (!keepUploadDir) {
        await cleanupUploadDir();
      }
    }
  });

  return app;
}
