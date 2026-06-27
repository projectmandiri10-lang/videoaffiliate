import {
  DEFAULT_SETTINGS,
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES,
  PLATFORM_CONFIG,
  SHORTS_TARGET_DURATION_SEC,
  buildReelsMetadataPrompt,
  buildScriptPrompt,
  buildSrt,
  detectDeviceMode,
  ensureSocialMetadata,
  finalizeShortsScore,
  getNextSequentialCtaIndex,
  heuristicScore,
  normalizeAppSettings,
  pickDeviceLimits,
  pickRandomCta,
  pickSequentialCta
} from "@app/core";
import type {
  AppSettings,
  ClipCandidate,
  DeviceMode,
  JobRecord,
  LocalArtifactRef,
  PlatformId,
  SocialMetadata,
  TtsVoiceOption
} from "@app/core";
import { putArtifact, getArtifactBlob, deleteArtifact } from "./artifact-store";
import {
  analyzeCandidatesWithProxy,
  fetchTtsVoicesFromProxy,
  generateMetadataWithProxy,
  generateScriptWithProxy,
  generateTtsWithProxy
} from "./ai-client";
import { loadJobs, loadSettings, saveJobs, saveSettings } from "./local-store";
import { RenderWorkerClient } from "./render-worker-client";
import { nowIso } from "./time";

interface PipelineSnapshot {
  initialized: boolean;
  jobs: JobRecord[];
  settings: AppSettings;
  voices: TtsVoiceOption[];
}

interface CreateJobInput {
  video: File;
  title: string;
  description: string;
  affiliateLink: string;
}

type PipelineListener = (snapshot: PipelineSnapshot) => void;

function randomId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `job-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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

function createYoutubePlatformRun(updatedAt: string) {
  return {
    platformId: "youtube" as const,
    status: "pending" as const,
    renderProfileId: PLATFORM_CONFIG.youtube.renderProfileId,
    artifactPaths: [] as LocalArtifactRef[],
    updatedAt
  };
}

async function readVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(video.duration);
    };
    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("Gagal membaca metadata video lokal."));
    };
    video.src = objectUrl;
  });
}

function listJobArtifacts(job: JobRecord): LocalArtifactRef[] {
  return [
    job.videoPath,
    ...(job.clipCandidates ?? []).map((candidate) => candidate.previewPath).filter(Boolean),
    job.finalRender?.mp4Path,
    job.finalRender?.srtPath,
    job.finalRender?.captionPath,
    job.finalRender?.previewAudioPath,
    ...job.platforms.flatMap((platform) => platform.artifactPaths)
  ].filter((item): item is LocalArtifactRef => Boolean(item));
}

export class PipelineRuntime {
  private readonly listeners = new Set<PipelineListener>();

  private readonly workerClient = new RenderWorkerClient();

  private readonly activeJobs = new Set<string>();

  private initialized = false;

  private jobs: JobRecord[] = [];

  private settings: AppSettings = DEFAULT_SETTINGS;

  private voices: TtsVoiceOption[] = GEMINI_TTS_VOICES;

  private cachedSnapshot: PipelineSnapshot | null = null;

  public constructor() {
    this.workerClient.onLog((message) => {
      const latestJob = this.jobs.find((job) => this.activeJobs.has(job.jobId));
      if (!latestJob) {
        return;
      }
      latestJob.runtime.lastWorkerLog = message;
      void this.persistAndEmit();
    });

    this.workerClient.onProgress((progress) => {
      const latestJob = this.jobs.find((job) => this.activeJobs.has(job.jobId));
      if (!latestJob) {
        return;
      }
      latestJob.runtime.progress = progress;
      void this.persistAndEmit();
    });
  }

  public subscribe(listener: PipelineListener): () => void {
    this.listeners.add(listener);
    listener(this.getSnapshot());
    void this.ensureInitialized();
    return () => this.listeners.delete(listener);
  }

  public getSnapshot(): PipelineSnapshot {
    if (!this.cachedSnapshot) {
      this.cachedSnapshot = {
        initialized: this.initialized,
        jobs: [...this.jobs],
        settings: this.settings,
        voices: this.voices
      };
    }
    return this.cachedSnapshot;
  }

  public async ensureInitialized(): Promise<void> {
    if (this.initialized) {
      return;
    }
    this.settings = await loadSettings();
    this.jobs = await this.markInterruptedJobs(await loadJobs());
    try {
      const voiceData = await fetchTtsVoicesFromProxy();
      this.voices = voiceData.voices;
    } catch {
      this.voices = GEMINI_TTS_VOICES;
    }
    this.initialized = true;
    await this.persistAndEmit();
  }

  public async fetchSettings(): Promise<AppSettings> {
    await this.ensureInitialized();
    return this.settings;
  }

  public async updateSettings(settings: AppSettings): Promise<AppSettings> {
    await this.ensureInitialized();
    this.settings = await saveSettings(normalizeAppSettings(settings));
    await this.emit();
    return this.settings;
  }

  public async fetchJobs(): Promise<JobRecord[]> {
    await this.ensureInitialized();
    return [...this.jobs];
  }

  public async createJob(input: CreateJobInput): Promise<{ jobId: string; status: string }> {
    await this.ensureInitialized();
    const deviceMode = detectDeviceMode(typeof window === "undefined" ? undefined : window);
    const limits = pickDeviceLimits(deviceMode);
    if (input.video.size > limits.maxUploadBytes) {
      throw new Error(
        `Ukuran video melebihi batas ${Math.round(limits.maxUploadBytes / (1024 * 1024))} MB untuk mode ${deviceMode}.`
      );
    }
    const durationSec = await readVideoDuration(input.video);
    if (durationSec > limits.maxVideoSeconds) {
      throw new Error(
        `Durasi video ${durationSec.toFixed(2)} detik melebihi batas ${limits.maxVideoSeconds} detik untuk mode ${deviceMode}.`
      );
    }
    const videoArtifact = await putArtifact({
      blob: input.video,
      fileName: input.video.name,
      mimeType: input.video.type || "video/mp4"
    });
    const createdAt = nowIso();
    const jobId = randomId();
    const job: JobRecord = {
      jobId,
      createdAt,
      updatedAt: createdAt,
      title: input.title,
      description: input.description,
      affiliateLink: input.affiliateLink,
      videoPath: videoArtifact,
      videoMimeType: input.video.type || "video/mp4",
      videoDurationSec: durationSec,
      overallStatus: "queued",
      workflow: "youtube_shorts",
      analysisStatus: "pending",
      clipCandidates: [],
      finalRender: {
        status: "idle",
        updatedAt: createdAt
      },
      platforms: [createYoutubePlatformRun(createdAt)],
      runtime: {
        deviceMode,
        stage: "preparing",
        progress: 0,
        statusMessage: limits.warning
      }
    };
    this.jobs = [job, ...this.jobs];
    await this.persistAndEmit();
    void this.runAnalysis(jobId);
    return {
      jobId,
      status: "queued"
    };
  }

  public async reanalyzeJob(jobId: string): Promise<void> {
    await this.ensureInitialized();
    const job = this.requireJob(jobId);
    for (const artifact of [
      ...(job.clipCandidates ?? []).map((candidate) => candidate.previewPath),
      job.finalRender?.mp4Path,
      job.finalRender?.srtPath,
      job.finalRender?.captionPath,
      job.finalRender?.previewAudioPath
    ]) {
      await deleteArtifact(artifact);
    }
    job.updatedAt = nowIso();
    job.overallStatus = "queued";
    job.analysisStatus = "pending";
    job.analysisErrorMessage = undefined;
    job.clipCandidates = [];
    job.selectedClipId = undefined;
    job.finalRender = {
      status: "idle",
      updatedAt: nowIso()
    };
    job.platforms = [createYoutubePlatformRun(nowIso())];
    job.runtime.progress = 0;
    job.runtime.stage = "preparing";
    job.runtime.statusMessage = "Analisis ulang dijadwalkan di browser.";
    await this.persistAndEmit();
    void this.runAnalysis(jobId);
  }

  public async selectClip(jobId: string, clipId: string): Promise<JobRecord> {
    await this.ensureInitialized();
    const job = this.requireJob(jobId);
    const selected = (job.clipCandidates ?? []).find((candidate) => candidate.clipId === clipId);
    if (!selected) {
      throw new Error("Kandidat clip tidak ditemukan.");
    }
    job.selectedClipId = clipId;
    job.overallStatus = "queued";
    job.finalRender = {
      ...job.finalRender,
      status: "pending",
      updatedAt: nowIso()
    };
    job.runtime.progress = 0;
    job.runtime.stage = "selecting_clip";
    job.runtime.statusMessage = "Render final sedang disiapkan di browser.";
    await this.persistAndEmit();
    void this.runRender(jobId);
    return job;
  }

  public async replaceJobSource(jobId: string, video: File): Promise<JobRecord> {
    await this.ensureInitialized();
    const job = this.requireJob(jobId);
    const limits = pickDeviceLimits(job.runtime.deviceMode);
    if (video.size > limits.maxUploadBytes) {
      throw new Error(
        `Ukuran video melebihi batas ${Math.round(limits.maxUploadBytes / (1024 * 1024))} MB untuk mode ${job.runtime.deviceMode}.`
      );
    }
    const durationSec = await readVideoDuration(video);
    if (durationSec > limits.maxVideoSeconds) {
      throw new Error(
        `Durasi video ${durationSec.toFixed(2)} detik melebihi batas ${limits.maxVideoSeconds} detik untuk mode ${job.runtime.deviceMode}.`
      );
    }
    const nextVideoArtifact = await putArtifact({
      blob: video,
      fileName: video.name,
      mimeType: video.type || "video/mp4"
    });
    await deleteArtifact(job.videoPath);
    job.videoPath = nextVideoArtifact;
    job.videoMimeType = video.type || "video/mp4";
    job.videoDurationSec = durationSec;
    await this.reanalyzeJob(jobId);
    return this.requireJob(jobId);
  }

  public async deleteJob(jobId: string): Promise<void> {
    await this.ensureInitialized();
    const job = this.requireJob(jobId);
    for (const artifact of listJobArtifacts(job)) {
      await deleteArtifact(artifact);
    }
    this.jobs = this.jobs.filter((item) => item.jobId !== jobId);
    await this.persistAndEmit();
  }

  public async previewTtsVoice(input: {
    voiceName: string;
    speechRate: number;
    text?: string;
  }): Promise<{ voiceName: string; previewPath: LocalArtifactRef }> {
    await this.ensureInitialized();
    const audio = await generateTtsWithProxy({
      model: this.settings.ttsModel,
      voiceName: input.voiceName,
      speechRate: input.speechRate,
      text:
        input.text ||
        "Ini contoh voice over YouTube Shorts affiliate. Cek link produk di deskripsi atau komentar tersemat."
    });
    const previewArtifact = await putArtifact({
      blob: new Blob([audio.data.slice()], { type: audio.mimeType }),
      fileName: `preview-${input.voiceName}.wav`,
      mimeType: audio.mimeType
    });
    return {
      voiceName: input.voiceName,
      previewPath: previewArtifact
    };
  }

  private async runAnalysis(jobId: string): Promise<void> {
    if (this.activeJobs.has(jobId)) {
      return;
    }
    this.activeJobs.add(jobId);
    try {
      const job = this.requireJob(jobId);
      job.overallStatus = "running";
      job.analysisStatus = "running";
      job.runtime.stage = "analyzing";
      job.runtime.progress = 0.05;
      job.runtime.statusMessage = "Menyiapkan analisis video lokal di browser.";
      await this.persistAndEmit();

      const videoBlob = await getArtifactBlob(job.videoPath);
      const sourceVideo = new Uint8Array(await videoBlob.arrayBuffer());
      const analyzed = await this.workerClient.analyzeVideo({
        sourceVideo,
        sourceFileName: job.videoPath.fileName,
        deviceMode: job.runtime.deviceMode
      });
      job.videoDurationSec = analyzed.durationSec;
      job.runtime.statusMessage = "Mengirim frame ringkas ke Gemini via LiteLLM proxy.";
      await this.persistAndEmit();

      const scoredByAi = await analyzeCandidatesWithProxy({
        model: this.settings.scriptModel,
        title: job.title,
        description: job.description,
        affiliateLink: job.affiliateLink || "",
        candidates: analyzed.candidates
      });

      const byClipId = new Map(scoredByAi.map((candidate) => [candidate.clipId, candidate]));
      const rescored = analyzed.candidates.map<ClipCandidate>((candidate) => {
        const aiCandidate = byClipId.get(candidate.clipId);
        const aiScore = aiCandidate?.score ?? heuristicScore(candidate, analyzed.durationSec);
        return {
          clipId: candidate.clipId,
          startSec: candidate.startSec,
          endSec: candidate.endSec,
          durationSec: candidate.durationSec,
          frameTimestamps: candidate.frameTimestamps,
          previewPath: undefined,
          reason: aiCandidate?.reason || "Clip ini cukup kuat untuk dijadikan YouTube Shorts.",
          score: finalizeShortsScore(candidate, analyzed.durationSec, aiScore)
        };
      });

      const shortlisted = rescored
        .sort((a, b) => b.score - a.score)
        .filter((candidate, index, candidates) => {
          return !candidates.slice(0, index).some((existing) => {
            return existing.startSec < candidate.endSec && candidate.startSec < existing.endSec;
          });
        })
        .slice(0, 3)
        .sort((a, b) => a.startSec - b.startSec);

      job.runtime.statusMessage = "Membuat preview kandidat clip langsung di browser.";
      await this.persistAndEmit();
      const previewResults = await this.workerClient.buildPreviews({
        sourceVideo,
        sourceFileName: job.videoPath.fileName,
        deviceMode: job.runtime.deviceMode,
        clips: shortlisted.map((candidate) => ({
          clipId: candidate.clipId,
          startSec: candidate.startSec,
          durationSec: candidate.durationSec
        }))
      });

      const previewEntries = await Promise.all(
        previewResults.map(async (preview): Promise<[string, LocalArtifactRef]> => [
          preview.clipId,
          await putArtifact({
            blob: preview.blob,
            fileName: `${job.jobId}-${preview.clipId}.mp4`,
            mimeType: "video/mp4"
          })
        ])
      );
      const previewMap = new Map<string, LocalArtifactRef>(
        previewEntries
      );

      job.clipCandidates = shortlisted.map((candidate) => ({
        ...candidate,
        previewPath: previewMap.get(candidate.clipId)
      }));
      job.analysisStatus = "done";
      job.runtime.stage = "done";
      job.runtime.progress = 1;
      job.runtime.statusMessage = "Analisis selesai. Pilih kandidat clip untuk render final.";
      job.updatedAt = nowIso();
      await this.persistAndEmit();
    } catch (error) {
      const job = this.jobs.find((item) => item.jobId === jobId);
      if (job) {
        job.analysisStatus = "failed";
        job.overallStatus = "failed";
        job.analysisErrorMessage = (error as Error).message;
        job.runtime.stage = "done";
        job.runtime.statusMessage = (error as Error).message;
        await this.persistAndEmit();
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private async runRender(jobId: string): Promise<void> {
    if (this.activeJobs.has(jobId)) {
      return;
    }
    this.activeJobs.add(jobId);
    try {
      const job = this.requireJob(jobId);
      const selected = (job.clipCandidates ?? []).find((candidate) => candidate.clipId === job.selectedClipId);
      if (!selected) {
        throw new Error("Clip terpilih tidak ditemukan.");
      }
      job.overallStatus = "running";
      if (job.finalRender) {
        job.finalRender.status = "running";
      }
      job.runtime.stage = "rendering";
      job.runtime.progress = 0.05;
      job.runtime.statusMessage = "Menyusun script, caption, dan voice over melalui Cloudflare proxy.";
      await this.persistAndEmit();

      const cta = this.settings.ctaMode === "sequential"
        ? pickSequentialCta("youtube", this.settings.ctaSequence.youtube)
        : pickRandomCta("youtube");

      if (this.settings.ctaMode === "sequential") {
        this.settings = await saveSettings({
          ...this.settings,
          ctaSequence: {
            ...this.settings.ctaSequence,
            youtube: getNextSequentialCtaIndex("youtube", this.settings.ctaSequence.youtube)
          }
        });
      }

      const matchingFrames = await this.workerClient.extractClipFrames({
        sourceVideo: new Uint8Array(await (await getArtifactBlob(job.videoPath)).arrayBuffer()),
        sourceFileName: job.videoPath.fileName,
        startSec: selected.startSec,
        durationSec: selected.durationSec
      });

      const prompt = buildScriptPrompt({
        settings: this.settings,
        platformId: "youtube",
        title: job.title,
        description: job.description,
        videoDurationSec: selected.durationSec,
        ctaText: cta.text
      });
      const scriptText = await generateScriptWithProxy({
        model: this.settings.scriptModel,
        prompt,
        frames: matchingFrames
      });
      const socialMetadata = ensureSocialMetadata(
        await generateMetadataWithProxy({
          model: this.settings.scriptModel,
          title: job.title,
          description: job.description,
          platformId: "youtube",
          scriptText,
          ctaText: cta.text
        }),
        fallbackCaption(job.title, job.description, cta.text),
        fallbackHashtags(job.title)
      );
      const ttsAudio = await generateTtsWithProxy({
        model: this.settings.ttsModel,
        text: scriptText,
        voiceName:
          this.settings.platforms.find((platform) => platform.platformId === "youtube")?.voiceName ||
          PLATFORM_CONFIG.youtube.defaultVoiceName,
        speechRate:
          this.settings.platforms.find((platform) => platform.platformId === "youtube")?.speechRate || 1
      });

      const videoBlob = await getArtifactBlob(job.videoPath);
      const sourceVideo = new Uint8Array(await videoBlob.arrayBuffer());
      const srtText = buildSrt(scriptText, selected.durationSec, "clear");
      const rendered = await this.workerClient.renderFinal({
        sourceVideo,
        sourceFileName: job.videoPath.fileName,
        startSec: selected.startSec,
        durationSec: selected.durationSec,
        audioBytes: ttsAudio.data,
        audioMimeType: ttsAudio.mimeType,
        subtitleText: srtText,
        deviceMode: job.runtime.deviceMode
      });

      const [mp4Artifact, srtArtifact, captionArtifact, audioArtifact] = await Promise.all([
        putArtifact({
          blob: rendered.blob,
          fileName: `${job.jobId}-final.mp4`,
          mimeType: "video/mp4"
        }),
        putArtifact({
          blob: new Blob([srtText], { type: "application/x-subrip" }),
          fileName: `${job.jobId}.srt`,
          mimeType: "application/x-subrip"
        }),
        putArtifact({
          blob: new Blob([`${socialMetadata.caption}\n\n${socialMetadata.hashtags.join(" ")}\n`], {
            type: "text/plain"
          }),
          fileName: `${job.jobId}-caption.txt`,
          mimeType: "text/plain"
        }),
        putArtifact({
          blob: new Blob([ttsAudio.data.slice()], { type: ttsAudio.mimeType }),
          fileName: `${job.jobId}-voice.wav`,
          mimeType: ttsAudio.mimeType
        })
      ]);

      job.finalRender = {
        status: "done",
        scriptText,
        captionText: socialMetadata.caption,
        hashtags: socialMetadata.hashtags,
        mp4Path: mp4Artifact,
        srtPath: srtArtifact,
        captionPath: captionArtifact,
        previewAudioPath: audioArtifact,
        updatedAt: nowIso()
      };
      job.platforms = [
        {
          ...createYoutubePlatformRun(nowIso()),
          status: "done",
          mp4Path: mp4Artifact,
          srtPath: srtArtifact,
          captionPath: captionArtifact,
          captionText: socialMetadata.caption,
          hashtags: socialMetadata.hashtags,
          scriptText,
          selectedCtaText: cta.text,
          selectedCtaIndex: cta.index,
          artifactPaths: [mp4Artifact, srtArtifact, captionArtifact, audioArtifact]
        }
      ];
      job.overallStatus = "success";
      job.runtime.stage = "done";
      job.runtime.progress = 1;
      job.runtime.statusMessage = "Render final selesai. File bisa diunduh langsung dari browser.";
      job.updatedAt = nowIso();
      await this.persistAndEmit();
    } catch (error) {
      const job = this.jobs.find((item) => item.jobId === jobId);
      if (job) {
        job.overallStatus = "failed";
        job.finalRender = {
          ...job.finalRender,
          status: "failed",
          errorMessage: (error as Error).message,
          updatedAt: nowIso()
        };
        job.runtime.stage = "done";
        job.runtime.statusMessage = (error as Error).message;
        await this.persistAndEmit();
      }
    } finally {
      this.activeJobs.delete(jobId);
    }
  }

  private requireJob(jobId: string): JobRecord {
    const job = this.jobs.find((item) => item.jobId === jobId);
    if (!job) {
      throw new Error("Job tidak ditemukan.");
    }
    return job;
  }

  private async markInterruptedJobs(jobs: JobRecord[]): Promise<JobRecord[]> {
    let changed = false;
    const nextJobs: JobRecord[] = jobs.map((job) => {
      const wasBusy =
        job.overallStatus === "queued" ||
        job.overallStatus === "running" ||
        job.analysisStatus === "running" ||
        job.analysisStatus === "pending" ||
        job.finalRender?.status === "running" ||
        job.finalRender?.status === "pending";
      if (!wasBusy) {
        return job;
      }
      changed = true;
      return {
        ...job,
        overallStatus: "interrupted" as const,
        analysisStatus:
          job.analysisStatus === "running" || job.analysisStatus === "pending"
            ? ("interrupted" as const)
            : job.analysisStatus,
        finalRender:
          job.finalRender &&
          (job.finalRender.status === "running" || job.finalRender.status === "pending")
            ? {
                ...job.finalRender,
                status: "interrupted" as const,
                errorMessage: "Render dihentikan karena tab browser ditutup atau di-refresh.",
                updatedAt: nowIso()
              }
            : job.finalRender,
        runtime: {
          ...job.runtime,
          stage: "done",
          progress: 0,
          interruptReason: "Tab browser harus tetap terbuka selama proses berlangsung.",
          statusMessage: "Job sebelumnya dihentikan karena sesi browser tidak lagi aktif."
        }
      };
    });
    if (changed) {
      await saveJobs(nextJobs);
    }
    return nextJobs;
  }

  private async persistAndEmit(): Promise<void> {
    this.jobs = await saveJobs(this.jobs);
    await this.emit();
  }

  private async emit(): Promise<void> {
    this.cachedSnapshot = null;
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) {
      listener(snapshot);
    }
  }
}

export const pipelineRuntime = new PipelineRuntime();
