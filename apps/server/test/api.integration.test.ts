import FormData from "form-data";
import pino from "pino";
import { existsSync } from "node:fs";
import { mkdir, readFile, readdir, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import type { StyleId } from "../src/types.js";
import { OUTPUTS_DIR, SETTINGS_FILE, UPLOADS_DIR } from "../src/utils/paths.js";
import { resetTestStorage } from "./helpers.js";

describe("api integration", () => {
  const logger = pino({ level: "silent" });
  const settingsStore = new SettingsStore();
  const jobsStore = new JobsStore();
  const enqueueCalls: Array<{ jobId: string; styleIds?: StyleId[] }> = [];
  const openCalls: string[] = [];
  const previewWrites: string[] = [];
  const processor = {
    enqueue(jobId: string, styleIds?: StyleId[]) {
      enqueueCalls.push({ jobId, styleIds });
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

  it("creates job from multipart upload", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("voiceName", "Aoede");
    form.append("speechRate", "1.05");
    form.append("title", "Judul Tes");
    form.append("description", "Deskripsi Tes");
    form.append("affiliateLink", "https://contoh-affiliate.test/abc");
    form.append("styleId", "evergreen");

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
    expect(enqueueCalls[0]?.styleIds).toEqual(["evergreen"]);
    const saved = await jobsStore.getById(payload.jobId);
    expect(saved?.affiliateLink).toBe("https://contoh-affiliate.test/abc");
    expect(saved?.voiceName).toBe("Aoede");
    expect(saved?.speechRate).toBeCloseTo(1.05, 6);
    expect(saved?.styles.map((style) => style.styleId)).toEqual(["evergreen"]);
  });

  it("rejects create job if styleId is missing", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Tanpa Style");
    form.append("description", "Deskripsi Tanpa Style");
    form.append("affiliateLink", "https://contoh-affiliate.test/no-style");

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
      styles: DEFAULT_SETTINGS.styles.map((style) =>
        style.styleId === "evergreen"
          ? {
              ...style,
              voiceName: "UnknownVoice"
            }
          : style
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

  it("retries failed style only", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Retry");
    form.append("description", "Deskripsi Retry");
    form.append("affiliateLink", "https://contoh-affiliate.test/retry");
    form.append("styleId", "evergreen");

    const createResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: form.getBuffer(),
      headers: form.getHeaders()
    });
    const payload = createResponse.json() as { jobId: string };
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      styles: job.styles.map((style, idx) =>
        idx === 0
          ? {
              ...style,
              status: "failed",
              errorMessage: "mock fail",
              updatedAt: new Date().toISOString()
            }
          : style
      )
    }));

    const retryResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/retry`,
      payload: {
        styleId: "evergreen"
      }
    });

    expect(retryResponse.statusCode).toBe(200);
    expect(enqueueCalls.length).toBeGreaterThan(1);
    expect(enqueueCalls[enqueueCalls.length - 1]?.styleIds).toEqual(["evergreen"]);
  });

  it("cleans upload temp dir when runtime processing fails", async () => {
    probeDuration = async () => {
      throw new Error("ffprobe gagal membaca file");
    };

    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Error Runtime");
    form.append("description", "Deskripsi Error Runtime");
    form.append("affiliateLink", "https://contoh-affiliate.test/runtime");
    form.append("styleId", "evergreen");

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

  it("opens output location", async () => {
    const form = new FormData();
    form.append("video", Buffer.from("fake-video-data"), {
      filename: "clip.mp4",
      contentType: "video/mp4"
    });
    form.append("title", "Judul Lokasi");
    form.append("description", "Deskripsi Lokasi");
    form.append("affiliateLink", "https://contoh-affiliate.test/lokasi");
    form.append("styleId", "evergreen");

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
        styleId: "evergreen"
      }
    });

    expect(openResponse.statusCode).toBe(200);
    expect(openCalls.length).toBe(1);
    expect(openCalls[0]).toContain(payload.jobId);
  });
});
