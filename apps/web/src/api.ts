import type { AppSettings, ExcitedVoicePreset, JobRecord, LocalArtifactRef, TtsVoiceOption } from "./types";
import {
  GEMINI_EXCITED_PRESETS,
  GEMINI_TTS_VOICES
} from "@app/core";
import {
  downloadArtifact,
  getArtifactObjectUrl,
  shareArtifact
} from "./lib/artifact-store";
import { pipelineRuntime } from "./lib/pipeline-runtime";

export async function fetchSettings(): Promise<AppSettings> {
  return pipelineRuntime.fetchSettings();
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  return pipelineRuntime.updateSettings(settings);
}

export async function createJob(input: {
  video: File;
  title: string;
  description: string;
  affiliateLink: string;
}): Promise<{ jobId: string; status: string }> {
  return pipelineRuntime.createJob(input);
}

export async function fetchJobs(): Promise<JobRecord[]> {
  return pipelineRuntime.fetchJobs();
}

export async function selectClip(jobId: string, clipId: string): Promise<JobRecord> {
  return pipelineRuntime.selectClip(jobId, clipId);
}

export async function reanalyzeJob(jobId: string): Promise<void> {
  await pipelineRuntime.reanalyzeJob(jobId);
}

export async function replaceJobSource(jobId: string, video: File): Promise<JobRecord> {
  return pipelineRuntime.replaceJobSource(jobId, video);
}

export async function deleteJob(jobId: string): Promise<void> {
  await pipelineRuntime.deleteJob(jobId);
}

export async function fetchTtsVoices(): Promise<{
  voices: TtsVoiceOption[];
  excitedPresets: ExcitedVoicePreset[];
}> {
  const snapshot = pipelineRuntime.getSnapshot();
  return {
    voices: snapshot.voices.length ? snapshot.voices : GEMINI_TTS_VOICES,
    excitedPresets: GEMINI_EXCITED_PRESETS
  };
}

export async function previewTtsVoice(input: {
  voiceName: string;
  speechRate: number;
  text?: string;
}): Promise<{ voiceName: string; previewPath: LocalArtifactRef }> {
  return pipelineRuntime.previewTtsVoice(input);
}

export async function toArtifactObjectUrl(artifact?: LocalArtifactRef): Promise<string | undefined> {
  return getArtifactObjectUrl(artifact);
}

export async function downloadArtifactFile(artifact?: LocalArtifactRef): Promise<void> {
  await downloadArtifact(artifact);
}

export async function shareArtifactFile(artifact?: LocalArtifactRef): Promise<boolean> {
  return shareArtifact(artifact);
}
