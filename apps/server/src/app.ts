import cors from "@fastify/cors";
import multipart, { type MultipartFile } from "@fastify/multipart";
import fastifyStatic from "@fastify/static";
import Fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
  type FastifyReply
} from "fastify";
import { createWriteStream } from "node:fs";
import { access, copyFile, mkdir, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import mime from "mime-types";
import { nanoid } from "nanoid";
import {
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES,
  MAX_UPLOAD_BYTES,
  findTtsVoiceByName
} from "./constants.js";
import { getRenderProfileIdForPlatform, pickRenderVariantKey } from "./render-config.js";
import type { GenerateSpeechInput, JobRecord } from "./types.js";
import { JobsStore } from "./stores/jobs-store.js";
import { AUTO_CANCEL_STALE_JOB_REASON } from "./stores/jobs-store.js";
import { SettingsStore } from "./stores/settings-store.js";
import {
  parseJobUpdateInput,
  parseSelectClipInput,
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
import { openPathInExplorer } from "./utils/open-location.js";
import { writeWav24kMono } from "./utils/audio.js";
import { normalizeApiError } from "./utils/api-error.js";
import { guessVideoMimeType } from "./utils/job-source.js";
import { pruneVoicePreviewFiles } from "./utils/voice-preview.js";
import type { IJobProcessor } from "./services/job-processor.js";

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

function sendNormalizedError(reply: FastifyReply, error: unknown, message: string) {
  const normalized = normalizeApiError(error);
  return reply.code(normalized.statusCode).send({
    message,
    error: normalized.error
  });
}

function pickVideoExtension(part: MultipartFile): string {
  const fromName = path.extname(part.filename || "").trim();
  if (fromName) {
    return fromName;
  }
  const fromMime = mime.extension(part.mimetype || "");
  return fromMime ? `.${fromMime}` : ".mp4";
}

function createYoutubePlatformRun(jobId: string): JobRecord["platforms"][number] {
  const renderProfileId = getRenderProfileIdForPlatform("youtube");
  return {
    platformId: "youtube",
    status: "pending",
    renderProfileId,
    renderVariantKey: pickRenderVariantKey(jobId, "youtube", renderProfileId),
    artifactPaths: [],
    updatedAt: nowIso()
  };
}

function isJobBusy(job: JobRecord): boolean {
  return job.overallStatus === "running" || job.analysisStatus === "running" || job.finalRender?.status === "running";
}

function listJobFilePaths(job: JobRecord): string[] {
  const outputUrls = [
    ...(job.clipCandidates?.map((candidate) => candidate.previewPath) ?? []),
    job.finalRender?.mp4Path,
    job.finalRender?.srtPath,
    job.finalRender?.captionPath,
    ...job.platforms.flatMap((platform) => [platform.mp4Path, platform.srtPath, platform.captionPath])
  ].filter((value): value is string => Boolean(value));

  return outputUrls
    .map((value) => outputUrlToAbsolutePath(value))
    .filter((value): value is string => Boolean(value));
}

async function cleanupUploadSideArtifacts(
  jobId: string,
  preservedPaths: string[] = []
): Promise<void> {
  const uploadDir = path.join(UPLOADS_DIR, jobId);
  const preserved = new Set(preservedPaths.map((item) => path.resolve(item)));
  let entries: string[];
  try {
    entries = await readdir(uploadDir);
  } catch {
    return;
  }

  await Promise.all(
    entries.map(async (entry) => {
      const targetPath = path.join(uploadDir, entry);
      if (preserved.has(path.resolve(targetPath))) {
        return;
      }
      await rm(targetPath, { recursive: true, force: true });
    })
  );
}

async function cleanupJobArtifacts(job: JobRecord): Promise<void> {
  await Promise.all(
    listJobFilePaths(job).map((filePath) => rm(filePath, { recursive: false, force: true }))
  );
}

async function deactivateOlderJobs(
  jobsStore: JobsStore,
  activeJobId: string,
  logger: FastifyBaseLogger
): Promise<void> {
  const suspendedCount = await jobsStore.suspendOtherIncompleteJobs(
    activeJobId,
    AUTO_CANCEL_STALE_JOB_REASON
  );
  if (suspendedCount > 0) {
    logger.info(
      { activeJobId, suspendedCount },
      "Job lama yang belum selesai dinonaktifkan karena ada job yang lebih baru."
    );
  }
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

  app.get("/api/tts/voices", async () => ({
    voices: GEMINI_TTS_VOICES,
    excitedPresets: GEMINI_EXCITED_PRESETS
  }));

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
        "Ini contoh voice over YouTube Shorts affiliate. Cek link produk di deskripsi atau komentar tersemat.";
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
    try {
      const job = await options.jobsStore.getById(params.jobId);
      if (!job) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }
      return job;
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memuat detail job.");
    }
  });

  app.put("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (isJobBusy(job)) {
      return reply.code(409).send({
        message: "Job sedang diproses dan tidak bisa diedit sekarang."
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
        updatedAt: nowIso()
      }));
      if (!updated) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }
      return reply.send(updated);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memperbarui job.");
    }
  });

  app.post("/api/jobs/:jobId/reanalyze", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (isJobBusy(job)) {
      return reply.code(409).send({
        message: "Job sedang diproses. Tunggu sampai proses saat ini selesai."
      });
    }

    try {
      await cleanupJobArtifacts(job);
      await options.jobsStore.update(params.jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        overallStatus: "queued",
        analysisStatus: "pending",
        analysisErrorMessage: undefined,
        clipCandidates: [],
        selectedClipId: undefined,
        finalRender: {
          status: "idle",
          updatedAt: nowIso()
        },
        platforms: [createYoutubePlatformRun(current.jobId)]
      }));
      await deactivateOlderJobs(options.jobsStore, params.jobId, options.logger);
      options.processor.enqueueAnalysis(params.jobId, { forceFresh: true });
      return reply.send({ ok: true });
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal menjadwalkan analisis ulang.");
    }
  });

  app.post("/api/jobs/:jobId/select-clip", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (isJobBusy(job)) {
      return reply.code(409).send({
        message: "Job sedang diproses. Tunggu sampai proses saat ini selesai."
      });
    }

    let payload;
    try {
      payload = parseSelectClipInput(request.body);
    } catch (error) {
      return sendNormalizedError(reply, error, "Pilihan clip tidak valid.");
    }

    const selectedClip = (job.clipCandidates ?? []).find((candidate) => candidate.clipId === payload.clipId);
    if (!selectedClip) {
      return reply.code(404).send({ message: "Kandidat clip tidak ditemukan." });
    }

    try {
      const updated = await options.jobsStore.update(params.jobId, (current) => ({
        ...current,
        updatedAt: nowIso(),
        selectedClipId: payload.clipId,
        overallStatus: "queued",
        finalRender: {
          ...current.finalRender,
          status: "pending",
          errorMessage: undefined,
          updatedAt: nowIso()
        },
        platforms: [createYoutubePlatformRun(current.jobId)]
      }));
      if (!updated) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }
      await deactivateOlderJobs(options.jobsStore, params.jobId, options.logger);
      options.processor.enqueueRender(params.jobId, { forceFresh: true });
      return reply.send(updated);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal memilih kandidat clip.");
    }
  });

  app.put("/api/jobs/:jobId/source", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (isJobBusy(job)) {
      return reply.code(409).send({
        message: "Source video tidak bisa diganti saat job sedang diproses."
      });
    }

    const parts = (
      request as unknown as {
        parts: () => AsyncIterable<MultipartFile | any>;
      }
    ).parts();
    const uploadDir = path.join(UPLOADS_DIR, params.jobId);
    let tempUploadPath = "";
    let nextMimeType = "video/mp4";

    const cleanupTempUpload = async () => {
      if (!tempUploadPath) {
        return;
      }
      const currentTempPath = tempUploadPath;
      tempUploadPath = "";
      await rm(currentTempPath, { recursive: false, force: true });
    };

    try {
      for await (const part of parts) {
        if (part.type === "file" && part.fieldname === "video") {
          await mkdir(uploadDir, { recursive: true });
          const extension = pickVideoExtension(part);
          tempUploadPath = path.join(uploadDir, `source-replacement-${Date.now()}${extension}`);
          nextMimeType = part.mimetype || guessVideoMimeType(tempUploadPath, "video/mp4");
          await pipeline(part.file, createWriteStream(tempUploadPath));
          continue;
        }
        if (part.type === "file") {
          part.file.resume();
        }
      }

      if (!tempUploadPath) {
        return reply.code(400).send({ message: "File video wajib diisi." });
      }

      const settings = await options.settingsStore.get();
      const durationSec = await durationProbe(tempUploadPath);
      if (durationSec > settings.maxVideoSeconds) {
        return reply.code(400).send({
          message: `Durasi video ${durationSec.toFixed(2)}s melebihi batas ${settings.maxVideoSeconds}s.`
        });
      }

      const nextSourcePath = path.join(uploadDir, `source${path.extname(tempUploadPath) || ".mp4"}`);
      nextMimeType = guessVideoMimeType(nextSourcePath, nextMimeType);
      await copyFile(tempUploadPath, nextSourcePath);
      tempUploadPath = "";

      await cleanupJobArtifacts(job);
      await cleanupUploadSideArtifacts(params.jobId, [nextSourcePath]);

      const updated = await options.jobsStore.update(params.jobId, (current) => ({
        ...current,
        videoPath: nextSourcePath,
        videoMimeType: nextMimeType,
        videoDurationSec: durationSec,
        updatedAt: nowIso(),
        overallStatus: "queued",
        analysisStatus: "pending",
        analysisErrorMessage: undefined,
        clipCandidates: [],
        selectedClipId: undefined,
        finalRender: {
          status: "idle",
          updatedAt: nowIso()
        },
        platforms: [createYoutubePlatformRun(current.jobId)]
      }));

      if (!updated) {
        return reply.code(404).send({ message: "Job tidak ditemukan." });
      }

      await deactivateOlderJobs(options.jobsStore, params.jobId, options.logger);
      options.processor.enqueueAnalysis(params.jobId, { forceFresh: true });
      return reply.send(updated);
    } catch (error) {
      return sendNormalizedError(reply, error, "Gagal mengganti source video job.");
    } finally {
      await cleanupTempUpload();
    }
  });

  app.delete("/api/jobs/:jobId", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }
    if (isJobBusy(job)) {
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

  app.post("/api/jobs/:jobId/open-location", async (request, reply) => {
    const params = request.params as { jobId: string };
    const job = await options.jobsStore.getById(params.jobId);
    if (!job) {
      return reply.code(404).send({ message: "Job tidak ditemukan." });
    }

    const finalOutput = job.finalRender?.mp4Path
      ? outputUrlToAbsolutePath(job.finalRender.mp4Path)
      : path.join(OUTPUTS_DIR, "youtube");
    const outputDir = finalOutput ? path.dirname(finalOutput) : path.join(OUTPUTS_DIR, "youtube");

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
        workflow: "youtube_shorts",
        analysisStatus: "pending",
        clipCandidates: [],
        finalRender: {
          status: "idle",
          updatedAt: now
        },
        platforms: [createYoutubePlatformRun(jobId)]
      };
      await options.jobsStore.create(job);
      keepUploadDir = true;
      await deactivateOlderJobs(options.jobsStore, jobId, options.logger);
      options.processor.enqueueAnalysis(jobId, { forceFresh: true });

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
