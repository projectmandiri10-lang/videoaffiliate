import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import path from "node:path";
import ffmpegPath from "ffmpeg-static";
import ffprobeStatic from "ffprobe-static";

const MAX_MODEL_UPLOAD_BYTES = 8 * 1024 * 1024;

interface AnalysisVideoVariant {
  crf: number;
  fps: number;
  scale: string;
}

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

const ANALYSIS_VIDEO_VARIANTS: AnalysisVideoVariant[] = [
  { crf: 35, fps: 2, scale: "360:-2" },
  { crf: 38, fps: 1, scale: "288:-2" },
  { crf: 40, fps: 1, scale: "240:-2" }
];

export interface PreparedModelVideo {
  filePath: string;
  mimeType: string;
  originalBytes: number;
  uploadBytes: number;
  compressed: boolean;
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

function analysisVideoPathFor(filePath: string): string {
  const parsed = path.parse(filePath);
  return path.join(path.dirname(filePath), "_analysis", `${parsed.name}-snifox-analysis.mp4`);
}

async function transcodeAnalysisVideo(
  sourcePath: string,
  outputPath: string,
  variant: AnalysisVideoVariant
): Promise<number> {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg([
    "-y",
    "-i",
    sourcePath,
    "-vf",
    `fps=${variant.fps},scale=${variant.scale}`,
    "-an",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    String(variant.crf),
    "-movflags",
    "+faststart",
    outputPath
  ]);
  return (await stat(outputPath)).size;
}

export async function prepareVideoForModelUpload(
  filePath: string,
  mimeType: string
): Promise<PreparedModelVideo> {
  const originalBytes = (await stat(filePath)).size;
  if (originalBytes <= MAX_MODEL_UPLOAD_BYTES) {
    return {
      filePath,
      mimeType,
      originalBytes,
      uploadBytes: originalBytes,
      compressed: false
    };
  }

  const outputPath = analysisVideoPathFor(filePath);
  try {
    const existingBytes = (await stat(outputPath)).size;
    if (existingBytes > 0 && existingBytes <= MAX_MODEL_UPLOAD_BYTES) {
      return {
        filePath: outputPath,
        mimeType: "video/mp4",
        originalBytes,
        uploadBytes: existingBytes,
        compressed: true
      };
    }
  } catch {
    // Tidak ada cache video analisis; buat baru di bawah.
  }

  let uploadBytes = 0;
  for (const variant of ANALYSIS_VIDEO_VARIANTS) {
    uploadBytes = await transcodeAnalysisVideo(filePath, outputPath, variant);
    if (uploadBytes <= MAX_MODEL_UPLOAD_BYTES) {
      break;
    }
  }

  return {
    filePath: outputPath,
    mimeType: "video/mp4",
    originalBytes,
    uploadBytes,
    compressed: true
  };
}
