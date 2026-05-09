import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { compareVideoVisualDifference } from "../src/utils/visual-audit.js";

const ffmpeg = ffmpegPath as unknown as string;

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(ffmpeg, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    proc.once("error", reject);
    proc.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr || String(code)));
        return;
      }
      resolve();
    });
  });
}

async function createSampleVideo(outputPath: string, withOverlay = false): Promise<void> {
  const filters = withOverlay
    ? "color=c=0x202020:s=320x568:d=3,drawbox=x=40:y=390:w=240:h=72:color=white:t=fill"
    : "color=c=0x202020:s=320x568:d=3";
  await runFfmpeg([
    "-y",
    "-f",
    "lavfi",
    "-i",
    filters,
    "-an",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    outputPath
  ]);
}

describe("visual audit", () => {
  let tempDir = "";

  beforeEach(async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "visual-audit-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns zero for identical videos", async () => {
    const videoPath = path.join(tempDir, "base.mp4");
    await createSampleVideo(videoPath);

    const result = await compareVideoVisualDifference(videoPath, videoPath);

    expect(result.score).toBe(0);
    expect(result.comparedBytes).toBeGreaterThan(0);
  });

  it("returns a positive score when one video has an overlay", async () => {
    const basePath = path.join(tempDir, "base.mp4");
    const overlayPath = path.join(tempDir, "overlay.mp4");
    await createSampleVideo(basePath);
    await createSampleVideo(overlayPath, true);

    const result = await compareVideoVisualDifference(basePath, overlayPath);

    expect(result.score).toBeGreaterThan(2);
    expect(result.comparedBytes).toBeGreaterThan(0);
  });
});
