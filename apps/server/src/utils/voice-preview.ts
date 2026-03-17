import { readdir, rm, stat } from "node:fs/promises";
import path from "node:path";

export const VOICE_PREVIEW_MAX_AGE_MS = 24 * 60 * 60 * 1000;
export const VOICE_PREVIEW_MAX_FILES = 25;

interface VoicePreviewLogger {
  warn: (context: Record<string, unknown>, message: string) => void;
}

interface VoicePreviewFile {
  filePath: string;
  mtimeMs: number;
}

export async function pruneVoicePreviewFiles(
  previewDir: string,
  options?: {
    logger?: VoicePreviewLogger;
    maxAgeMs?: number;
    maxFiles?: number;
  }
): Promise<void> {
  let entries;
  try {
    entries = await readdir(previewDir, { withFileTypes: true });
  } catch (error) {
    const readError = error as NodeJS.ErrnoException;
    if (readError.code === "ENOENT") {
      return;
    }
    throw error;
  }

  const files = (
    await Promise.all(
      entries
        .filter((entry) => entry.isFile())
        .map(async (entry) => {
          const filePath = path.join(previewDir, entry.name);
          try {
            const fileStat = await stat(filePath);
            return {
              filePath,
              mtimeMs: fileStat.mtimeMs
            } satisfies VoicePreviewFile;
          } catch (error) {
            const statError = error as NodeJS.ErrnoException;
            if (statError.code === "ENOENT") {
              return undefined;
            }
            throw error;
          }
        })
    )
  ).filter((item): item is VoicePreviewFile => Boolean(item));

  const maxAgeMs = options?.maxAgeMs ?? VOICE_PREVIEW_MAX_AGE_MS;
  const maxFiles = options?.maxFiles ?? VOICE_PREVIEW_MAX_FILES;
  const now = Date.now();

  const recentFiles = files
    .filter((file) => now - file.mtimeMs <= maxAgeMs)
    .sort((left, right) => right.mtimeMs - left.mtimeMs);
  const expiredFiles = files.filter((file) => now - file.mtimeMs > maxAgeMs);
  const overflowFiles = recentFiles.slice(maxFiles);
  const removableFiles = [...expiredFiles, ...overflowFiles];

  await Promise.all(
    removableFiles.map(async (file) => {
      try {
        await rm(file.filePath, { force: true });
      } catch (error) {
        options?.logger?.warn(
          {
            err: error,
            filePath: file.filePath
          },
          "Gagal menghapus preview voice lama."
        );
      }
    })
  );
}
