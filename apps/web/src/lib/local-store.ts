import { DEFAULT_SETTINGS, MAX_HISTORY, normalizeAppSettings } from "@app/core";
import type { AppSettings, JobRecord } from "@app/core";
import { dbSet, dbGet } from "./browser-db";

const SETTINGS_KEY = "browser-settings";
const JOBS_KEY = "browser-jobs";

export async function loadSettings(): Promise<AppSettings> {
  const stored = await dbGet<AppSettings>("settings", SETTINGS_KEY);
  return normalizeAppSettings(stored ?? DEFAULT_SETTINGS);
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized = normalizeAppSettings(settings);
  await dbSet("settings", SETTINGS_KEY, normalized);
  return normalized;
}

export async function loadJobs(): Promise<JobRecord[]> {
  return (await dbGet<JobRecord[]>("jobs", JOBS_KEY)) ?? [];
}

export async function saveJobs(jobs: JobRecord[]): Promise<JobRecord[]> {
  const trimmed = [...jobs]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, MAX_HISTORY);
  await dbSet("jobs", JOBS_KEY, trimmed);
  return trimmed;
}
