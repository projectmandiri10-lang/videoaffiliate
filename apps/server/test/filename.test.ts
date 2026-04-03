import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  resolveVersionedBaseName,
  sanitizeWindowsFilenameBase,
  slugifyOutputBase
} from "../src/utils/filename.js";

const TMP_DIR = path.resolve(process.env.APP_STORAGE_ROOT || ".", "filename-test");

afterEach(async () => {
  await rm(TMP_DIR, { recursive: true, force: true });
});

describe("filename utils", () => {
  it("removes illegal chars and trims", () => {
    expect(sanitizeWindowsFilenameBase('Produk / Baru: "A"*?')).toBe("Produk Baru A");
  });

  it("removes trailing dots/spaces", () => {
    expect(sanitizeWindowsFilenameBase("Judul....   ")).toBe("Judul");
  });

  it("falls back when empty", () => {
    expect(sanitizeWindowsFilenameBase("   ")).toBe("video");
  });

  it("avoids reserved windows names", () => {
    expect(sanitizeWindowsFilenameBase("CON")).toBe("CON-video");
    expect(sanitizeWindowsFilenameBase("lpt9")).toBe("lpt9-video");
  });

  it("slugifies output filenames for platform folders", () => {
    expect(slugifyOutputBase("Sabun Jerawat ++ Promo")).toBe("sabun-jerawat-promo");
  });

  it("resolves versioned base names without overwriting", async () => {
    await mkdir(TMP_DIR, { recursive: true });
    await writeFile(path.join(TMP_DIR, "sabun-jerawat.mp4"), "old", "utf8");

    const next = await resolveVersionedBaseName({
      directory: TMP_DIR,
      preferredBaseName: "Sabun Jerawat",
      suffixes: [".mp4", ".srt", ".txt"]
    });

    expect(next).toBe("sabun-jerawat-2");
  });
});
