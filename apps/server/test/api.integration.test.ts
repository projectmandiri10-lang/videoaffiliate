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

describe("api integration", () => {
  const logger = pino({ level: "silent" });
  const settingsStore = new SettingsStore();
  const jobsStore = new JobsStore();
  const enqueueCalls: Array<{ jobId: string; platformIds?: PlatformId[] }> = [];
  const openCalls: string[] = [];
  const previewWrites: string[] = [];
  const processor = {
    enqueue(jobId: string, platformIds?: PlatformId[]) {
      enqueueCalls.push({ jobId, platformIds });
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
