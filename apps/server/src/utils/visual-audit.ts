import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import ffmpegPath from "ffmpeg-static";

export interface VisualDifferenceResult {
  score: number;
  comparedBytes: number;
}

const SAMPLE_FRAME_COUNT = 8;
const SAMPLE_SIZE = 64;

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

async function sampleVideoFrames(filePath: string): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const proc = spawn(
      FFMPEG_EXEC,
      [
        "-v",
        "error",
        "-i",
        filePath,
        "-vf",
        `fps=1,scale=${SAMPLE_SIZE}:${SAMPLE_SIZE}:force_original_aspect_ratio=decrease,pad=${SAMPLE_SIZE}:${SAMPLE_SIZE}:(ow-iw)/2:(oh-ih)/2,format=gray`,
        "-frames:v",
        String(SAMPLE_FRAME_COUNT),
        "-f",
        "rawvideo",
        "-"
      ],
      { windowsHide: true }
    );

    const chunks: Buffer[] = [];
    let stderr = "";
    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
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
        reject(new Error(`Gagal mengambil sampel visual video: ${stderr || code}`));
        return;
      }
      const sample = Buffer.concat(chunks);
      if (sample.length === 0) {
        reject(new Error("Sampel visual video kosong."));
        return;
      }
      resolve(sample);
    });
  });
}

export async function compareVideoVisualDifference(
  leftVideoPath: string,
  rightVideoPath: string
): Promise<VisualDifferenceResult> {
  const [left, right] = await Promise.all([
    sampleVideoFrames(leftVideoPath),
    sampleVideoFrames(rightVideoPath)
  ]);
  const comparedBytes = Math.min(left.length, right.length);
  if (comparedBytes === 0) {
    throw new Error("Sampel visual video tidak bisa dibandingkan.");
  }

  let totalDifference = 0;
  for (let index = 0; index < comparedBytes; index += 1) {
    totalDifference += Math.abs(left[index]! - right[index]!);
  }

  return {
    score: Number((totalDifference / comparedBytes).toFixed(2)),
    comparedBytes
  };
}
