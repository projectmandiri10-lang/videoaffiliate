import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PlatformRun } from "../types.js";
import { outputUrlToAbsolutePath } from "./paths.js";

export async function writeCaptionArtifactForPlatform(
  platform: PlatformRun,
  affiliateLink?: string
): Promise<void> {
  if (!platform.captionPath) {
    return;
  }

  const outputPath = outputUrlToAbsolutePath(platform.captionPath);
  if (!outputPath) {
    return;
  }

  const parts = [
    platform.captionText?.trim() ?? "",
    platform.hashtags?.join(" ") ?? "",
    affiliateLink?.trim() ?? ""
  ].filter((part) => part.length > 0);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${parts.join("\n\n")}\n`, "utf8");
}
