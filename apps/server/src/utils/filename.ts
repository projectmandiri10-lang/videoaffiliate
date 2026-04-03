import { access } from "node:fs/promises";
import path from "node:path";

const ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAILING_DOTS_SPACES = /[. ]+$/g;
const RESERVED_WINDOWS_NAMES = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

export function sanitizeWindowsFilenameBase(
  input: string,
  options?: { fallback?: string; maxLength?: number }
): string {
  const fallback = options?.fallback ?? "video";
  const maxLength = options?.maxLength ?? 80;

  const raw = String(input ?? "");
  let base = raw
    .replace(ILLEGAL_FILENAME_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(TRAILING_DOTS_SPACES, "")
    .trim();

  if (base.length > maxLength) {
    base = base.slice(0, maxLength).trim().replace(TRAILING_DOTS_SPACES, "").trim();
  }

  if (!base) {
    base = fallback;
  }

  if (RESERVED_WINDOWS_NAMES.test(base)) {
    const suffix = "-video";
    const room = Math.max(1, maxLength - suffix.length);
    const trimmed = base.slice(0, room).trim().replace(TRAILING_DOTS_SPACES, "").trim();
    base = `${trimmed}${suffix}`;
  }

  return base;
}

export function slugifyOutputBase(
  input: string,
  options?: { fallback?: string; maxLength?: number }
): string {
  const fallback = options?.fallback ?? "video";
  const maxLength = options?.maxLength ?? 80;
  const sanitized = sanitizeWindowsFilenameBase(input, {
    fallback,
    maxLength: maxLength * 2
  });
  let slug = sanitized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

  if (slug.length > maxLength) {
    slug = slug.slice(0, maxLength).replace(/-+$/g, "");
  }

  return slug || fallback;
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function resolveVersionedBaseName(input: {
  directory: string;
  preferredBaseName: string;
  suffixes: string[];
}): Promise<string> {
  const baseName = slugifyOutputBase(input.preferredBaseName);
  let version = 1;

  while (true) {
    const candidate = version === 1 ? baseName : `${baseName}-${version}`;
    const matches = await Promise.all(
      input.suffixes.map((suffix) => pathExists(path.join(input.directory, `${candidate}${suffix}`)))
    );
    if (!matches.some(Boolean)) {
      return candidate;
    }
    version += 1;
  }
}
