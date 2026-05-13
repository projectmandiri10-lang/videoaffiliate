import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";
import type { AnalysisFrame } from "../types.js";

const ANALYSIS_FRAME_RATIOS = [0.15, 0.38, 0.62, 0.85];
const ANALYSIS_FRAME_MAX_WIDTH = 768;

interface FfprobeStream {
  codec_type?: string;
  width?: number;
  height?: number;
  tags?: {
    rotate?: string;
  };
  side_data_list?: Array<{
    rotation?: number;
  }>;
}

interface FfprobeJsonOutput {
  streams?: FfprobeStream[];
  format?: {
    duration?: string;
  };
}

export interface ProbedVideoMetadata {
  durationSec: number;
  width: number;
  height: number;
  rotation: number;
  displayWidth: number;
  displayHeight: number;
}

function resolveFfmpegExecutable(): string {
  const fromEnv = process.env.FFMPEG_PATH?.trim();
  if (fromEnv) {
    return fromEnv;
  }

  const fromPackage = (ffmpegPath as unknown as string | null) ?? null;
  if (fromPackage && existsSync(fromPackage)) {
    return fromPackage;
  }

  return "ffmpeg";
}

const FFMPEG_EXEC = resolveFfmpegExecutable();

function getFfprobePath(): string {
  const ffprobePath = (ffprobeStatic as { path?: string }).path;
  if (!ffprobePath) {
    throw new Error("ffprobe-static tidak tersedia.");
  }
  return ffprobePath;
}

function normalizeRotation(rotation: number): number {
  const normalized = ((rotation % 360) + 360) % 360;
  return normalized === 270 ? -90 : normalized;
}

function resolveStreamRotation(stream: FfprobeStream | undefined): number {
  const tagged = Number(stream?.tags?.rotate);
  if (Number.isFinite(tagged)) {
    return normalizeRotation(tagged);
  }

  const sided = Number(
    stream?.side_data_list?.find((item) => Number.isFinite(item.rotation))?.rotation
  );
  if (Number.isFinite(sided)) {
    return normalizeRotation(sided);
  }

  return 0;
}

export async function probeVideoDuration(filePath: string): Promise<number> {
  const ffprobePath = getFfprobePath();

  return new Promise<number>((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      filePath
    ];
    const process = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    process.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    process.once("error", (error) => reject(error));
    process.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Gagal membaca durasi video: ${stderr || code}`));
        return;
      }
      const duration = Number(stdout.trim());
      if (!Number.isFinite(duration) || duration <= 0) {
        reject(new Error("Durasi video tidak valid."));
        return;
      }
      resolve(duration);
    });
  });
}

export async function probeVideoMetadata(filePath: string): Promise<ProbedVideoMetadata> {
  const ffprobePath = getFfprobePath();

  return new Promise<ProbedVideoMetadata>((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_streams",
      "-show_format",
      "-print_format",
      "json",
      filePath
    ];
    const process = spawn(ffprobePath, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";

    process.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    process.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    process.once("error", (error) => reject(error));
    process.once("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Gagal membaca metadata video: ${stderr || code}`));
        return;
      }

      let parsed: FfprobeJsonOutput;
      try {
        parsed = JSON.parse(stdout) as FfprobeJsonOutput;
      } catch (error) {
        reject(
          new Error(
            `Metadata video tidak bisa diparse: ${
              (error as { message?: string })?.message || "JSON tidak valid"
            }`
          )
        );
        return;
      }

      const durationSec = Number(parsed.format?.duration);
      const videoStream = parsed.streams?.find((stream) => stream.codec_type === "video");
      const width = Number(videoStream?.width);
      const height = Number(videoStream?.height);
      if (!Number.isFinite(durationSec) || durationSec <= 0) {
        reject(new Error("Durasi video dari metadata tidak valid."));
        return;
      }
      if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) {
        reject(new Error("Resolusi video dari metadata tidak valid."));
        return;
      }

      const rotation = resolveStreamRotation(videoStream);
      const rotated = Math.abs(rotation) === 90;
      resolve({
        durationSec,
        width,
        height,
        rotation,
        displayWidth: rotated ? height : width,
        displayHeight: rotated ? width : height
      });
    });
  });
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_EXEC, args, { windowsHide: true });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += String(chunk);
    });
    proc.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        reject(
          new Error(
            `ffmpeg tidak ditemukan (${FFMPEG_EXEC}). Jalankan 'npm rebuild ffmpeg-static' atau set env FFMPEG_PATH ke lokasi ffmpeg.exe.`
          )
        );
        return;
      }
      reject(error);
    });
    proc.once("close", (code: number | null) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg gagal membuat video analisis: ${stderr || code}`));
        return;
      }
      resolve();
    });
  });
}

function toFrameTimestamp(durationSec: number, ratio: number): number {
  const maxTimestamp = Math.max(0, durationSec - 0.1);
  const rawTimestamp = Math.max(0, Math.min(maxTimestamp, durationSec * ratio));
  return Number(rawTimestamp.toFixed(3));
}

async function extractFrameToJpeg(
  sourcePath: string,
  outputPath: string,
  timestampSec: number
): Promise<void> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-ss",
    timestampSec.toFixed(3),
    "-i",
    sourcePath,
    "-frames:v",
    "1",
    "-vf",
    `scale='min(${ANALYSIS_FRAME_MAX_WIDTH},iw)':-2`,
    "-q:v",
    "3",
    outputPath
  ]);
}

function buildFrameOutputPath(filePath: string, index: number): string {
  return path.join(path.dirname(filePath), "_analysis", `frame-${String(index + 1).padStart(2, "0")}.jpg`);
}

function buildAnalysisTimestamps(durationSec: number): number[] {
  const unique = new Set<number>();
  for (const ratio of ANALYSIS_FRAME_RATIOS) {
    unique.add(toFrameTimestamp(durationSec, ratio));
  }
  return [...unique];
}

export async function extractAnalysisFrames(
  filePath: string,
  durationSec: number
): Promise<AnalysisFrame[]> {
  const timestamps = buildAnalysisTimestamps(durationSec);
  const frames: AnalysisFrame[] = [];

  for (const [index, timestampSec] of timestamps.entries()) {
    const outputPath = buildFrameOutputPath(filePath, index);
    await extractFrameToJpeg(filePath, outputPath, timestampSec);
    const imageBuffer = await readFile(outputPath);
    frames.push({
      dataUrl: `data:image/jpeg;base64,${imageBuffer.toString("base64")}`,
      timestampSec
    });
  }

  return frames;
}
