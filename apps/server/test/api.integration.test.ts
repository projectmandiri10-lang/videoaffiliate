import FormData from "form-data";
import pino from "pino";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/app.js";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { JobsStore } from "../src/stores/jobs-store.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import { OUTPUTS_DIR, SETTINGS_FILE, UPLOADS_DIR } from "../src/utils/paths.js";
import { resetTestStorage } from "./helpers.js";

function buildCreateForm(overrides?: {
  title?: string;
  description?: string;
  affiliateLink?: string | null;
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
  const enqueueAnalysisCalls: Array<{ jobId: string; forceFresh?: boolean }> = [];
  const enqueueRenderCalls: Array<{ jobId: string; forceFresh?: boolean }> = [];
  const openCalls: string[] = [];
  const previewWrites: string[] = [];
  const processor = {
    enqueueAnalysis(jobId: string, options?: { forceFresh?: boolean }) {
      enqueueAnalysisCalls.push({ jobId, ...options });
    },
    enqueueRender(jobId: string, options?: { forceFresh?: boolean }) {
      enqueueRenderCalls.push({ jobId, ...options });
    },
    async whenIdle() {}
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
    enqueueAnalysisCalls.length = 0;
    enqueueRenderCalls.length = 0;
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

  it("creates a youtube-only job from multipart upload and enqueues analysis", async () => {
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
    expect(enqueueAnalysisCalls).toEqual([{ jobId: payload.jobId, forceFresh: true }]);
    const saved = await jobsStore.getById(payload.jobId);
    expect(saved?.workflow).toBe("youtube_shorts");
    expect(saved?.analysisStatus).toBe("pending");
    expect(saved?.platforms.map((platform) => platform.platformId)).toEqual(["youtube"]);
  });

  it("deactivates older incomplete jobs when a newer job is created", async () => {
    const firstForm = buildCreateForm({
      title: "Job Pertama",
      description: "Deskripsi Pertama",
      affiliateLink: "https://contoh-affiliate.test/first"
    });
    const firstResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: firstForm.getBuffer(),
      headers: firstForm.getHeaders()
    });
    const firstPayload = firstResponse.json() as { jobId: string };

    const secondForm = buildCreateForm({
      title: "Job Kedua",
      description: "Deskripsi Kedua",
      affiliateLink: "https://contoh-affiliate.test/second"
    });
    const secondResponse = await app.inject({
      method: "POST",
      url: "/api/jobs",
      payload: secondForm.getBuffer(),
      headers: secondForm.getHeaders()
    });
    const secondPayload = secondResponse.json() as { jobId: string };

    const firstJob = await jobsStore.getById(firstPayload.jobId);
    const secondJob = await jobsStore.getById(secondPayload.jobId);

    expect(firstJob?.overallStatus).toBe("interrupted");
    expect(firstJob?.analysisStatus).toBe("failed");
    expect(firstJob?.analysisErrorMessage).toContain("job yang lebih baru");
    expect(secondJob?.overallStatus).toBe("queued");
    expect(enqueueAnalysisCalls).toEqual([
      { jobId: firstPayload.jobId, forceFresh: true },
      { jobId: secondPayload.jobId, forceFresh: true }
    ]);
  });

  it("rejects create job if affiliateLink is missing", async () => {
    const form = buildCreateForm({ affiliateLink: null });

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
  });

  it("returns tts voices catalog and can generate preview", async () => {
    const voicesResponse = await app.inject({
      method: "GET",
      url: "/api/tts/voices"
    });
    expect(voicesResponse.statusCode).toBe(200);

    const previewResponse = await app.inject({
      method: "POST",
      url: "/api/tts/preview",
      payload: {
        voiceName: "Aoede",
        speechRate: 1
      }
    });

    expect(previewResponse.statusCode).toBe(200);
    expect(previewWrites.length).toBe(1);
  });

  it("selects a clip and enqueues final render", async () => {
    const form = buildCreateForm({
      title: "Judul Select",
      description: "Deskripsi Select",
      affiliateLink: "https://contoh-affiliate.test/select"
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
      analysisStatus: "done",
      clipCandidates: [
        {
          clipId: "clip_1",
          startSec: 0,
          endSec: 24,
          durationSec: 24,
          score: 8.9,
          reason: "Hook visual kuat.",
          frameTimestamps: [1, 12, 23]
        }
      ]
    }));

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/select-clip`,
      payload: {
        clipId: "clip_1"
      }
    });

    expect(response.statusCode).toBe(200);
    expect(enqueueRenderCalls).toEqual([{ jobId: payload.jobId, forceFresh: true }]);
    const updated = await jobsStore.getById(payload.jobId);
    expect(updated?.selectedClipId).toBe("clip_1");
    expect(updated?.finalRender?.status).toBe("pending");
  });

  it("reanalyzes idle jobs and resets prior clip state", async () => {
    const form = buildCreateForm({
      title: "Judul Reanalyze",
      description: "Deskripsi Reanalyze",
      affiliateLink: "https://contoh-affiliate.test/reanalyze"
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
      analysisStatus: "done",
      selectedClipId: "clip_1",
      clipCandidates: [
        {
          clipId: "clip_1",
          startSec: 0,
          endSec: 24,
          durationSec: 24,
          score: 8.9,
          reason: "Hook visual kuat.",
          previewPath: "/outputs/youtube/previews/reanalyze.mp4",
          frameTimestamps: [1, 12, 23]
        }
      ],
      finalRender: {
        status: "done",
        mp4Path: "/outputs/youtube/final.mp4",
        updatedAt: new Date().toISOString()
      }
    }));

    const response = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/reanalyze`
    });

    expect(response.statusCode).toBe(200);
    expect(enqueueAnalysisCalls.at(-1)).toEqual({ jobId: payload.jobId, forceFresh: true });
    const updated = await jobsStore.getById(payload.jobId);
    expect(updated?.clipCandidates).toEqual([]);
    expect(updated?.selectedClipId).toBeUndefined();
    expect(updated?.finalRender?.status).toBe("idle");
  });

  it("updates idle job metadata and blocks busy jobs", async () => {
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

    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      overallStatus: "running"
    }));
    const blockedResponse = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}`,
      payload: {
        title: "Judul Gagal",
        description: "Deskripsi Gagal",
        affiliateLink: "https://contoh-affiliate.test/gagal"
      }
    });
    expect(blockedResponse.statusCode).toBe(409);
  });

  it("replaces job source and enqueues fresh analysis", async () => {
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
    const replaceForm = buildSourceReplaceForm("replacement.webm", "video/webm");

    const response = await app.inject({
      method: "PUT",
      url: `/api/jobs/${payload.jobId}/source`,
      payload: replaceForm.getBuffer(),
      headers: replaceForm.getHeaders()
    });

    expect(response.statusCode).toBe(200);
    const updated = await jobsStore.getById(payload.jobId);
    expect(updated?.videoPath).toBe(path.join(UPLOADS_DIR, payload.jobId, "source.webm"));
    expect(updated?.analysisStatus).toBe("pending");
    expect(enqueueAnalysisCalls.at(-1)).toEqual({ jobId: payload.jobId, forceFresh: true });
  });

  it("deletes non-running job and opens output location", async () => {
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
    const outputDir = path.join(OUTPUTS_DIR, "youtube");
    const mp4Path = path.join(outputDir, "judul-hapus.mp4");
    await mkdir(outputDir, { recursive: true });
    await writeFile(mp4Path, "dummy-output", "utf8");
    await jobsStore.update(payload.jobId, (job) => ({
      ...job,
      analysisStatus: "done",
      finalRender: {
        status: "done",
        mp4Path: "/outputs/youtube/judul-hapus.mp4",
        updatedAt: new Date().toISOString()
      }
    }));

    const openResponse = await app.inject({
      method: "POST",
      url: `/api/jobs/${payload.jobId}/open-location`
    });
    expect(openResponse.statusCode).toBe(200);
    expect(openCalls.length).toBe(1);

    const deleteResponse = await app.inject({
      method: "DELETE",
      url: `/api/jobs/${payload.jobId}`
    });
    expect(deleteResponse.statusCode).toBe(200);
    expect(await jobsStore.getById(payload.jobId)).toBeUndefined();
    expect(existsSync(path.join(UPLOADS_DIR, payload.jobId))).toBe(false);
  });
});
