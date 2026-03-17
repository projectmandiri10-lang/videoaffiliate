import type {
  AppSettings,
  ExcitedVoicePreset,
  JobRecord,
  StyleId,
  TtsVoiceOption
} from "./types";

const DEV_BACKEND_PORT = "8787";

function trimTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

function resolveApiBase(): string {
  const envBase = import.meta.env.VITE_API_BASE?.trim();
  if (envBase) {
    return trimTrailingSlash(envBase);
  }
  if (typeof window === "undefined") {
    return `http://localhost:${DEV_BACKEND_PORT}`;
  }
  if (import.meta.env.DEV) {
    return `${window.location.protocol}//${window.location.hostname}:${DEV_BACKEND_PORT}`;
  }
  return window.location.origin;
}

const API_BASE = resolveApiBase();

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { message?: string; error?: string };
      message = body.error ? `${body.message || "Error"}: ${body.error}` : body.message || message;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as T;
}

export async function fetchSettings(): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/api/settings`);
  return parseResponse<AppSettings>(res);
}

export async function updateSettings(settings: AppSettings): Promise<AppSettings> {
  const res = await fetch(`${API_BASE}/api/settings`, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(settings)
  });
  return parseResponse<AppSettings>(res);
}

export async function createJob(input: {
  video: File;
  voiceName: string;
  speechRate: number;
  title: string;
  description: string;
  affiliateLink: string;
  styleId: StyleId;
}): Promise<{ jobId: string; status: string }> {
  const form = new FormData();
  form.append("video", input.video);
  form.append("voiceName", input.voiceName);
  form.append("speechRate", String(input.speechRate));
  form.append("title", input.title);
  form.append("description", input.description);
  form.append("affiliateLink", input.affiliateLink);
  form.append("styleId", input.styleId);
  const res = await fetch(`${API_BASE}/api/jobs`, {
    method: "POST",
    body: form
  });
  return parseResponse<{ jobId: string; status: string }>(res);
}

export async function fetchJobs(): Promise<JobRecord[]> {
  const res = await fetch(`${API_BASE}/api/jobs`);
  return parseResponse<JobRecord[]>(res);
}

export async function fetchJobDetail(jobId: string): Promise<JobRecord> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}`);
  return parseResponse<JobRecord>(res);
}

export async function retryStyle(jobId: string, styleId: StyleId): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/retry`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ styleId })
  });
  await parseResponse<{ ok: boolean }>(res);
}

export async function openStyleOutputLocation(
  jobId: string,
  styleId: StyleId
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/jobs/${jobId}/open-location`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ styleId })
  });
  await parseResponse<{ ok: boolean }>(res);
}

export async function fetchTtsVoices(): Promise<{
  voices: TtsVoiceOption[];
  excitedPresets: ExcitedVoicePreset[];
}> {
  const res = await fetch(`${API_BASE}/api/tts/voices`);
  return parseResponse<{
    voices: TtsVoiceOption[];
    excitedPresets: ExcitedVoicePreset[];
  }>(res);
}

export async function previewTtsVoice(input: {
  voiceName: string;
  speechRate: number;
  text?: string;
}): Promise<{ voiceName: string; previewPath: string }> {
  const res = await fetch(`${API_BASE}/api/tts/preview`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(input)
  });
  return parseResponse<{ voiceName: string; previewPath: string }>(res);
}

export function toAbsoluteOutputUrl(relativePath: string): string {
  if (relativePath.startsWith("http://") || relativePath.startsWith("https://")) {
    return relativePath;
  }
  return `${API_BASE}${relativePath}`;
}
