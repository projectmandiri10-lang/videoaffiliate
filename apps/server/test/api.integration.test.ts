import FormData from "form-data";
import pino from "pino";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DEFAULT_SETTINGS, PLATFORM_ORDER } from "../src/constants.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import type { PlatformId } from "../src/types.js";
import { OUTPUTS_DIR, SETTINGS_FILE, UPLOADS_DIR } from "../src/utils/paths.js";
import { resetTestStorage } from "./helpers.js";

function buildCreateForm(overrides?: {
  title?: string;
  description?: string;
  affiliateLink?: string;
}) {
  const form = new FormData();
  form.append("video", Buffer.from("fake-video-data"), {
    filename: "clip.mp4",
    contentType: "video/mp4"
  });
  form.append("title", overrides?.title ?? "Judul Tes");
  form.append("description", overrides?.description ?? "Deskripsi Tes");
  if (overrides?.affiliateLink !== null) {
    form.append(
      "affiliateLink",
      overrides?.affiliateLink ?? "https://contoh-affiliate.test/abc"
    );
  }
  return form;
}

function buildSourceReplaceForm(filename = "replacement.mp4", contentType = "video/mp4") {
  const form = new FormData();
  form.append("video", Buffer.from("replacement-video-data"), {
    filename,
    contentType
  });
  return form;
}

describe("api integration", () => {
  const logger = pino({ level: "silent" });
  const settingsStore = new SettingsStore();
  const jobsStore = new JobsStore();
  const enqueueCalls: Array<{
    jobId: string;
    platformIds?: PlatformId[];
    forceFresh?: boolean;
  }> = [];
  const retryCaptionCalls: Array<{ jobId: string; platformId: PlatformId }> = [];
  const openCalls: string[] = [];
  const previewWrites: string[] = [];
  const processor = {
    enqueue(jobId: string, platformIds?: PlatformId[], options?: { forceFresh?: boolean }) {
      enqueueCalls.push({ jobId, platformIds, ...options });
    },
    async retryCaption(jobId: string, platformId: PlatformId) {
      retryCaptionCalls.push({ jobId, platformId });
      const updated = await jobsStore.update(jobId, (job) => ({
        ...job,
        platforms: job.platforms.map((platform) =>
          platform.platformId === platformId
            ? {
                ...platform,
                captionText: "Caption retry dari processor.",
                hashtags: ["#retry"]
              }
            : platform
        )
      }));
      if (!updated) {
        throw new Error("Job tidak ditemukan.");
      }
      return updated;
    }
  };

  let app: Awaited<ReturnType<typeof buildApp>>;
  let probeDuration: (videoPath: string) => Promise<number>;
  let generateSpeech: (
    input: {
      model: string;
      text: string;
      voiceName: string;
      speechRate: number;
    }
  ) => Promise<{ data: Buffer; mimeType: string }>;

  beforeEach(async () => {
    enqueueCalls.length = 0;
    retryCaptionCalls.length = 0;
    openCalls.length = 0;
    previewWrites.length = 0;
    probeDuration = async () => 30;
    generateSpeech = async () => ({
      data: Buffer.from("preview-audio"),
      mimeType: "audio/wav"
    });
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
    app = await buildApp({
      logger,
      webOrigins: ["http://localhost:5173"],
      settingsStore,
      jobsStore,
      processor,
      probeDuration: async (videoPath) => probeDuration(videoPath),
      openOutputLocation: async (folderPath) => {
        openCalls.push(folderPath);
      },
      speechGenerator: {
        generateSpeech: async (input) => generateSpeech(input)
      },
      writePreviewAudio: async (_data, _mimeType, outputPath) => {
        previewWrites.push(outputPath);
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, "preview", "utf8");
      }
    });
    await app.ready();
  });

  afterEach(async () => {
    if (app) {
      await app.close();
    }
  });

  it("creates a job from multipart upload for all platforms", async () => {
    const form = buildCreateForm();

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(202);
    const payload = response.json() as { jobId: string; status: string };
    expect(payload.status).toBe("queued");
    expect(enqueueCalls.length).toBe(1);
    expect(enqueueCalls[0]?.jobId).toBe(payload.jobId);
    expect(enqueueCalls[0]?.platformIds).toEqual(PLATFORM_ORDER);
    const saved = await jobsStore.getById(payload.jobId);
    expect(saved?.affiliateLink).toBe("https://contoh-affiliate.test/abc");
    expect(saved?.platforms.map((platform) => platform.platformId)).toEqual(PLATFORM_ORDER);
  });

  it("rejects create job if affiliateLink is missing", async () => {
    const form = buildCreateForm({ affiliateLink: null as unknown as string });

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(400);
  });

  it("updates settings and affects next fetch", async () => {
    const updated = {
      ...DEFAULT_SETTINGS,
      scriptModel: "custom-script-model"
    };
    const putResponse = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: updated
    });
    expect(putResponse.statusCode).toBe(200);

    const getResponse = await app.inject({
      method: "GET",
      url: "/api/settings"
    });
    expect(getResponse.statusCode).toBe(200);
    const fetched = getResponse.json() as typeof updated;
    expect(fetched.scriptModel).toBe("custom-script-model");
  });

  it("rejects settings with unknown voice name", async () => {
    const updated = {
      ...DEFAULT_SETTINGS,
      platforms: DEFAULT_SETTINGS.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              voiceName: "UnknownVoice"
            }
          : platform
      )
    };

    const response = await app.inject({
      method: "PUT",
      url: "/api/settings",
      payload: updated
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      message: "Settings tidak valid."
    });
  });

  it("returns tts voices catalog", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/api/tts/voices"
    });

    expect(response.statusCode).toBe(200);
    const payload = response.json() as {
      voices: Array<{ voiceName: string }>;
      excitedPresets: Array<{ presetId: string }>;
    };
    expect(Array.isArray(payload.voices)).toBe(true);
    expect(payload.voices.length).toBeGreaterThan(0);
    expect(Array.isArray(payload.excitedPresets)).toBe(true);
    expect(payload.excitedPresets.length).toBeGreaterThan(0);
  });

  it("returns 500 and preserves file when settings json is corrupt", async () => {
    await writeFile(SETTINGS_FILE, "{invalid-json", "utf8");

    const response = await app.inject({
      method: "GET",
      url: "/api/settings"
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      message: "Gagal memuat settings."
    });
    expect(response.json().error).toContain("File JSON tidak valid");
    expect(await readFile(SETTINGS_FILE, "utf8")).toBe("{invalid-json");
  });

  it("maps gemini rate limit preview failure to 429", async () => {
    generateSpeech = async () => {
      throw new Error('{"error":{"code":429,"status":"RESOURCE_EXHAUSTED"}}');
    };

    const response = await app.inject({
      method: "POST",
      url: "/api/tts/preview",
      payload: {
        voiceName: "Aoede",
        speechRate: 1
      }
    });

    expect(response.statusCode).toBe(429);
    expect(response.json()).toMatchObject({
      message: "Gagal membuat preview voice."
    });
  });

  it("prunes old voice previews when generating a new preview", async () => {
    const previewDir = path.join(OUTPUTS_DIR, "_voice_previews");
    const expiredPreview = path.join(previewDir, "expired.wav");
    await mkdir(previewDir, { recursive: true });
    await writeFile(expiredPreview, "old-preview", "utf8");
    const oldDate = new Date(Date.now() - 26 * 60 * 60 * 1000);
    await utimes(expiredPreview, oldDate, oldDate);

    const response = await app.inject({
      method: "POST",
      url: "/api/tts/preview",
      payload: {
        voiceName: "Aoede",
        speechRate: 1,
        text: "Tes preview baru"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(existsSync(expiredPreview)).toBe(false);
    expect(previewWrites.length).toBe(1);
  });

  it("retries failed platform only", async () => {
    const form = buildCreateForm({
      title: "Judul Retry",
      description: "Deskripsi Retry",
      affiliateLink: "https://contoh-affiliate.test/retry"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "failed",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "failed",
              errorMessage: "mock fail",
              updatedAt: new Date().toISOString()
            }
          : platform
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/retry`,
      payload: {
        platformId: "tiktok"
      }
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(enqueueCalls.length).toBeGreaterThan(1);
    expect(enqueueCalls[enqueueCalls.length - 1]?.platformIds).toEqual(["tiktok"]);
  });

  it("blocks retry while platform cooldown is still active", async () => {
    const form = buildCreateForm({
      title: "Judul Cooldown",
      description: "Deskripsi Cooldown",
      affiliateLink: "https://contoh-affiliate.test/cooldown"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "failed",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "failed",
              errorMessage: "mock fail",
              retryAfter: new Date(Date.now() + 30_000).toISOString(),
              updatedAt: new Date().toISOString()
            }
          : platform
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/retry`,
      payload: {
        platformId: "tiktok"
      }
    });

    expect(retryResponse.statusCode).toBe(429);
    expect(retryResponse.json()).toMatchObject({
      message: "Retry masih cooldown."
    });
    expect(enqueueCalls).toHaveLength(1);
  });

  it("queues forced retry job for completed platform", async () => {
    const form = buildCreateForm({
      title: "Judul Retry Job",
      description: "Deskripsi Retry Job",
      affiliateLink: "https://contoh-affiliate.test/retry-job"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "success",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "done",
              captionText: "Caption lama.",
              hashtags: ["#lama"],
              updatedAt: new Date().toISOString()
            }
          : { ...platform, status: "done" }
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/platforms/tiktok/retry-job`
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(enqueueCalls[enqueueCalls.length - 1]).toMatchObject({
      jobId: payload.jobId,
      platformIds: ["tiktok"],
      forceFresh: true
    });
  });

  it("retries caption through processor when script exists", async () => {
    const form = buildCreateForm({
      title: "Judul Retry Caption",
      description: "Deskripsi Retry Caption",
      affiliateLink: "https://contoh-affiliate.test/retry-caption"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "success",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "done",
              scriptText: "Script sudah ada.",
              captionText: "Caption lama.",
              hashtags: ["#lama"],
              updatedAt: new Date().toISOString()
            }
          : { ...platform, status: "done" }
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/platforms/tiktok/retry-caption`
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(retryCaptionCalls).toEqual([{ jobId: payload.jobId, platformId: "tiktok" }]);
    expect(retryResponse.json()).toMatchObject({
      jobId: payload.jobId
    });
  });

  it("edits platform metadata and rewrites caption artifact", async () => {
    const form = buildCreateForm({
      title: "Judul Platform",
      description: "Deskripsi Platform",
      affiliateLink: "https://contoh-affiliate.test/platform"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    const outputDir = path.join(OUTPUTS_DIR, "tiktok");
    const captionFile = path.join(outputDir, "judul-platform-caption.txt");
    await mkdir(outputDir, { recursive: true });
    await writeFile(captionFile, "caption lama\n", "utf8");
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "success",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "done",
              captionPath: "/outputs/tiktok/judul-platform-caption.txt",
              captionText: "Caption lama.",
              hashtags: ["#lama"],
              updatedAt: new Date().toISOString()
            }
          : { ...platform, status: "done" }
      )
    }));

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/platforms/tiktok/metadata`,
      payload: {
        title: "Judul Khusus TikTok",
        description: "Deskripsi khusus TikTok",
        affiliateLink: "https://contoh-affiliate.test/tiktok",
        captionText: "Caption manual #Affiliate",
        hashtags: ["#affiliate", "#PlanterBag"]
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json();
    const tiktok = updated.platforms.find(
      (platform: { platformId: string }) => platform.platformId === "tiktok"
    );
    expect(tiktok).toMatchObject({
      titleOverride: "Judul Khusus TikTok",
      descriptionOverride: "Deskripsi khusus TikTok",
      affiliateLinkOverride: "https://contoh-affiliate.test/tiktok",
      captionText: "Caption manual"
    });
    expect(tiktok.hashtags).toEqual(["#affiliate", "#planterbag"]);
    const captionFileText = await readFile(captionFile, "utf8");
    expect(captionFileText).toContain("Caption manual");
    expect(captionFileText).toContain("#affiliate #planterbag");
    expect(captionFileText).toContain("https://contoh-affiliate.test/tiktok");
  });

  it("normalizes legacy nested caption when jobs are fetched", async () => {
    const form = buildCreateForm({
      title: "Judul Legacy",
      description: "Deskripsi Legacy",
      affiliateLink: "https://contoh-affiliate.test/legacy"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      platforms: job.platforms.map((platform) =>
        platform.platformId === "youtube"
          ? {
              ...platform,
              captionText: JSON.stringify({
                caption: "Caption bersih dari JSON.",
                hashtags: [" g", "#Shorts"]
              }),
              hashtags: ["#affiliate", "#Shorts"]
            }
          : platform
      )
    }));

    const jobsResponse = await app.inject({
      method: "GET",
      url: "/api/jobs"
    });

    expect(jobsResponse.statusCode).toBe(200);
    const jobs = jobsResponse.json();
    const youtube = jobs[0].platforms.find(
      (platform: { platformId: string }) => platform.platformId === "youtube"
    );
    expect(youtube.captionText).toBe("Caption bersih dari JSON.");
    expect(youtube.hashtags).toEqual(["#shorts", "#affiliate"]);
  });

  it("rejects platform action while job is running", async () => {
    const form = buildCreateForm({
      title: "Judul Running Platform",
      description: "Deskripsi Running Platform",
      affiliateLink: "https://contoh-affiliate.test/running-platform"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "running",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok" ? { ...platform, status: "running" } : platform
      )
    }));

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/platforms/tiktok/retry-job`
    });

    expect(response.statusCode).toBe(409);
  });

  it("updates editable job metadata", async () => {
    const form = buildCreateForm({
      title: "Judul Awal",
      description: "Deskripsi Awal",
      affiliateLink: "https://contoh-affiliate.test/awal"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}`,
      payload: {
        title: "Judul Baru",
        description: "Deskripsi Baru",
        affiliateLink: "https://contoh-affiliate.test/baru"
      }
    });

    expect(updateResponse.statusCode).toBe(200);
    const updated = updateResponse.json() as {
      title: string;
      description: string;
      affiliateLink: string;
    };
    expect(updated.title).toBe("Judul Baru");
    expect(updated.description).toBe("Deskripsi Baru");
    expect(updated.affiliateLink).toBe("https://contoh-affiliate.test/baru");
  });

  it("rejects update for completed job", async () => {
    const form = buildCreateForm({
      title: "Judul Selesai",
      description: "Deskripsi Selesai",
      affiliateLink: "https://contoh-affiliate.test/selesai"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "success"
    }));

    const updateResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}`,
      payload: {
        title: "Judul Gagal Edit",
        description: "Deskripsi Gagal Edit",
        affiliateLink: "https://contoh-affiliate.test/gagal-edit"
      }
    });

    expect(updateResponse.statusCode).toBe(409);
  });

  it("replaces job source, clears stale artifacts, and preserves platform overrides", async () => {
    probeDuration = async (videoPath) => (videoPath.endsWith(".webm") ? 18 : 30);

    const form = buildCreateForm({
      title: "Judul Source",
      description: "Deskripsi Source",
      affiliateLink: "https://contoh-affiliate.test/source"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    const uploadDir = path.join(UPLOADS_DIR, payload.jobId);
    const oldSourcePath = path.join(uploadDir, "source.mp4");
    const ttsPath = path.join(uploadDir, "tiktok-tts.wav");
    const analysisFile = path.join(uploadDir, "_analysis", "source-snifox-analysis.mp4");
    const outputDir = path.join(OUTPUTS_DIR, "tiktok");
    const mp4Path = path.join(outputDir, "judul-source.mp4");
    const captionPath = path.join(outputDir, "judul-source-caption.txt");
    await mkdir(path.dirname(analysisFile), { recursive: true });
    await mkdir(outputDir, { recursive: true });
    await writeFile(ttsPath, "old-tts", "utf8");
    await writeFile(analysisFile, "old-analysis", "utf8");
    await writeFile(mp4Path, "old-mp4", "utf8");
    await writeFile(captionPath, "old-caption", "utf8");
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "partial_success",
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              status: "done",
              titleOverride: "Judul TikTok Lama",
              descriptionOverride: "Deskripsi TikTok Lama",
              affiliateLinkOverride: "https://contoh-affiliate.test/tiktok-lama",
              scriptText: "Script lama",
              captionText: "Caption lama",
              hashtags: ["#lama"],
              scriptCacheKey: "script-cache-lama",
              captionCacheKey: "caption-cache-lama",
              ttsCacheKey: "tts-cache-lama",
              renderCacheKey: "render-cache-lama",
              mp4Path: "/outputs/tiktok/judul-source.mp4",
              captionPath: "/outputs/tiktok/judul-source-caption.txt",
              artifactPaths: [
                "/outputs/tiktok/judul-source.mp4",
                "/outputs/tiktok/judul-source-caption.txt"
              ]
            }
          : {
              ...platform,
              status: "done"
            }
      )
    }));

    const replaceForm = buildSourceReplaceForm("replacement.webm", "video/webm");
    const response = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/source`,
      payload: replaceForm.getBuffer(),
      headers: replaceForm.getHeaders()
    });

    expect(response.statusCode).toBe(200);
    const updated = response.json() as {
      videoPath: string;
      videoMimeType: string;
      videoDurationSec: number;
      overallStatus: string;
      platforms: Array<{
        platformId: string;
        status: string;
        errorMessage?: string;
        titleOverride?: string;
        descriptionOverride?: string;
        affiliateLinkOverride?: string;
        mp4Path?: string;
        captionPath?: string;
        scriptText?: string;
        captionText?: string;
        artifactPaths: string[];
      }>;
    };
    expect(updated.videoPath).toBe(path.join(uploadDir, "source.webm"));
    expect(updated.videoMimeType).toBe("video/webm");
    expect(updated.videoDurationSec).toBe(18);
    expect(updated.overallStatus).toBe("failed");
    expect(updated.platforms.every((platform) => platform.status === "failed")).toBe(true);
    const updatedTiktok = updated.platforms.find((platform) => platform.platformId === "tiktok");
    expect(updatedTiktok).toMatchObject({
      titleOverride: "Judul TikTok Lama",
      descriptionOverride: "Deskripsi TikTok Lama",
      affiliateLinkOverride: "https://contoh-affiliate.test/tiktok-lama",
      errorMessage: "Source video diganti. Klik Retry Job untuk membuat output baru."
    });
    expect(updatedTiktok?.mp4Path).toBeUndefined();
    expect(updatedTiktok?.captionPath).toBeUndefined();
    expect(updatedTiktok?.scriptText).toBeUndefined();
    expect(updatedTiktok?.captionText).toBeUndefined();
    expect(updatedTiktok?.artifactPaths).toEqual([]);
    expect(existsSync(oldSourcePath)).toBe(false);
    expect(existsSync(path.join(uploadDir, "source.webm"))).toBe(true);
    expect(existsSync(ttsPath)).toBe(false);
    expect(existsSync(path.join(uploadDir, "_analysis"))).toBe(false);
    expect(existsSync(mp4Path)).toBe(false);
    expect(existsSync(captionPath)).toBe(false);
  });

  it("rejects source replace for queued and running jobs", async () => {
    const form = buildCreateForm({
      title: "Judul Replace Reject",
      description: "Deskripsi Replace Reject",
      affiliateLink: "https://contoh-affiliate.test/replace-reject"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    const replaceForm = buildSourceReplaceForm();

    const queuedResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/source`,
      payload: replaceForm.getBuffer(),
      headers: replaceForm.getHeaders()
    });

    expect(queuedResponse.statusCode).toBe(409);

    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "running"
    }));

    const runningForm = buildSourceReplaceForm("running.mp4", "video/mp4");
    const runningResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/source`,
      payload: runningForm.getBuffer(),
      headers: runningForm.getHeaders()
    });

    expect(runningResponse.statusCode).toBe(409);
  });

  it("rejects source replace when new duration exceeds settings limit", async () => {
    probeDuration = async (videoPath) => (videoPath.endsWith(".webm") ? 999 : 30);

    const form = buildCreateForm({
      title: "Judul Replace Durasi",
      description: "Deskripsi Replace Durasi",
      affiliateLink: "https://contoh-affiliate.test/replace-duration"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    const before = await jobsStore.getById(payload.jobId);
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "success",
      platforms: job.platforms.map((platform) => ({
        ...platform,
        status: "done"
      }))
    }));

    const replaceForm = buildSourceReplaceForm("too-long.webm", "video/webm");
    const response = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/source`,
      payload: replaceForm.getBuffer(),
      headers: replaceForm.getHeaders()
    });

    expect(response.statusCode).toBe(400);
    const after = await jobsStore.getById(payload.jobId);
    const uploadEntries = await readdir(path.join(UPLOADS_DIR, payload.jobId));
    expect(after?.videoPath).toBe(before?.videoPath);
    expect(after?.videoDurationSec).toBe(before?.videoDurationSec);
    expect(uploadEntries.some((entry) => entry.startsWith("source-replacement-"))).toBe(false);
  });

  it("deletes non-running job and cleans artifacts in platform folders", async () => {
    const form = buildCreateForm({
      title: "Judul Hapus",
      description: "Deskripsi Hapus",
      affiliateLink: "https://contoh-affiliate.test/hapus"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    const outputDir = path.join(OUTPUTS_DIR, "tiktok");
    const mp4Path = path.join(outputDir, "judul-hapus.mp4");
    await mkdir(outputDir, { recursive: true });
    await writeFile(mp4Path, "dummy-output", "utf8");
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      platforms: job.platforms.map((platform) =>
        platform.platformId === "tiktok"
          ? {
              ...platform,
              mp4Path: "/outputs/tiktok/judul-hapus.mp4",
              artifactPaths: ["/outputs/tiktok/judul-hapus.mp4"]
            }
          : platform
      )
    }));

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/jobs/${payload.jobId}`
    });

    expect(deleteResponse.statusCode).toBe(200);
    expect(await jobsStore.getById(payload.jobId)).toBeUndefined();
    expect(existsSync(path.join(UPLOADS_DIR, payload.jobId))).toBe(false);
    expect(existsSync(mp4Path)).toBe(false);
  });

  it("rejects delete for running job", async () => {
    const form = buildCreateForm({
      title: "Judul Running",
      description: "Deskripsi Running",
      affiliateLink: "https://contoh-affiliate.test/running"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "running"
    }));

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/jobs/${payload.jobId}`
    });

    expect(deleteResponse.statusCode).toBe(409);
  });

  it("cleans upload temp dir when runtime processing fails", async () => {
    probeDuration = async () => {
      throw new Error("ffprobe gagal membaca file");
    };

    const form = buildCreateForm({
      title: "Judul Error Runtime",
      description: "Deskripsi Error Runtime",
      affiliateLink: "https://contoh-affiliate.test/runtime"
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({
      message: "Gagal memproses upload video."
    });
    expect(await readdir(UPLOADS_DIR)).toEqual([]);
  });

  it("opens platform output location", async () => {
    const form = buildCreateForm({
      title: "Judul Lokasi",
      description: "Deskripsi Lokasi",
      affiliateLink: "https://contoh-affiliate.test/lokasi"
    });

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };

    const openResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/open-location`,
      payload: {
        platformId: "tiktok"
      }
    });

    expect(openResponse.statusCode).toBe(200);
    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toContain("tiktok");
  });
});
