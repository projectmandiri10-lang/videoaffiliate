import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

export const ROOT_DIR = path.resolve(CURRENT_DIR, "../../../..");
const STORAGE_ROOT_DIR = process.env.APP_STORAGE_ROOT?.trim()
  ? path.resolve(process.env.APP_STORAGE_ROOT)
  : ROOT_DIR;

export const DATA_DIR = path.join(STORAGE_ROOT_DIR, "data");
export const OUTPUTS_DIR = path.join(STORAGE_ROOT_DIR, "outputs");
export const UPLOADS_DIR = path.join(STORAGE_ROOT_DIR, "uploads");
export const LOGS_DIR = path.join(STORAGE_ROOT_DIR, "logs");
export const SETTINGS_FILE = path.join(DATA_DIR, "settings.json");
export const JOBS_FILE = path.join(DATA_DIR, "jobs.json");
export const WEB_DIST_DIR = path.join(ROOT_DIR, "apps", "web", "dist");

export function outputUrlToAbsolutePath(outputUrl: string): string | undefined {
  if (!outputUrl.startsWith("/outputs/")) {
    return undefined;
  }
  const relativeParts = outputUrl
    .slice("/outputs/".length)
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
  return path.join(OUTPUTS_DIR, ...relativeParts);
}

export async function ensureAppDirs(): Promise<void> {
  await Promise.all([
    mkdir(DATA_DIR, { recursive: true }),
    mkdir(OUTPUTS_DIR, { recursive: true }),
    mkdir(UPLOADS_DIR, { recursive: true }),
    mkdir(LOGS_DIR, { recursive: true })
  ]);
}
