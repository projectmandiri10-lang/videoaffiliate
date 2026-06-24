import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
import {
  SHORTS_MIN_DURATION_SEC,
  buildClipCandidateDrafts,
  heuristicScore,
  pickDeviceLimits
} from "@app/core";
import type { AnalysisFrame, ClipCandidateDraft, DeviceMode } from "@app/core";

type WorkerCommand = "analyzeVideo" | "buildPreviews" | "renderFinal" | "extractClipFrames";

interface WorkerRequest<T extends WorkerCommand> {
  requestId: string;
  command: T;
  payload: T extends "analyzeVideo"
    ? {
        sourceVideo: Uint8Array;
        sourceFileName: string;
        deviceMode: DeviceMode;
      }
    : T extends "buildPreviews"
      ? {
          sourceVideo: Uint8Array;
          sourceFileName: string;
          clips: Array<{
            clipId: string;
            startSec: number;
            durationSec: number;
          }>;
          deviceMode: DeviceMode;
        }
      : T extends "extractClipFrames"
        ? {
            sourceVideo: Uint8Array;
            sourceFileName: string;
            startSec: number;
            durationSec: number;
          }
      : {
          sourceVideo: Uint8Array;
          sourceFileName: string;
          startSec: number;
          durationSec: number;
          audioBytes: Uint8Array;
          audioMimeType: string;
          subtitleText: string;
          deviceMode: DeviceMode;
        };
}

const ffmpeg = new FFmpeg();
let ffmpegLoaded = false;

function postLog(message: string) {
  self.postMessage({
    type: "log",
    message
  });
}

function postProgress(progress: number) {
  self.postMessage({
    type: "progress",
    progress
  });
}

function fileStem(fileName: string): string {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex > 0 ? fileName.slice(0, dotIndex) : fileName;
}

function bytesToDataUrl(bytes: Uint8Array, mimeType: string): string {
  let binary = "";
  for (const value of bytes) {
    binary += String.fromCharCode(value);
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
}

function pcmToWav(audioBytes: Uint8Array, mimeType: string): Uint8Array {
  if (mimeType === "audio/wav") {
    return audioBytes;
  }
  const sampleRate = 24000;
  const channels = 1;
  const bitsPerSample = 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const blockAlign = channels * (bitsPerSample / 8);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeString(0, "RIFF");
  view.setUint32(4, 36 + audioBytes.length, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, "data");
  view.setUint32(40, audioBytes.length, true);
  return new Uint8Array([...new Uint8Array(header), ...audioBytes]);
}

async function ensureLoaded(): Promise<void> {
  if (ffmpegLoaded) {
    return;
  }
  const baseURL = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/umd";
  ffmpeg.on("log", ({ message }) => postLog(message));
  ffmpeg.on("progress", ({ progress }) => postProgress(progress));
  await ffmpeg.load({
    coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm")
  });
  ffmpegLoaded = true;
}

async function cleanup(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await ffmpeg.deleteFile(path);
    } catch {
      // Ignore missing temporary files.
    }
  }
}

async function readDuration(sourceFileName: string): Promise<number> {
  const outputFile = `${fileStem(sourceFileName)}-duration.txt`;
  await ffmpeg.ffprobe([
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    sourceFileName,
    "-o",
    outputFile
  ]);
  const data = await ffmpeg.readFile(outputFile, "utf8");
  await cleanup([outputFile]);
  return Number(String(data).trim());
}

function chooseCandidateFrameTimes(startSec: number, durationSec: number): number[] {
  const safeDuration = Math.max(durationSec, SHORTS_MIN_DURATION_SEC);
  const marks = [0.14, 0.72].map((ratio) => startSec + safeDuration * ratio);
  return marks.map((value) => Number(value.toFixed(3)));
}

function chooseVoiceoverFrameTimes(startSec: number, durationSec: number): number[] {
  const safeDuration = Math.max(durationSec, SHORTS_MIN_DURATION_SEC);
  const marks = [0.04, 0.12, 0.22, 0.38, 0.58, 0.82].map(
    (ratio) => startSec + safeDuration * ratio
  );
  return marks.map((value) => Number(value.toFixed(3)));
}

async function extractFrame(sourceFileName: string, timestampSec: number, index: number): Promise<AnalysisFrame> {
  const outputFile = `frame-${index}.jpg`;
  await ffmpeg.exec([
    "-ss",
    timestampSec.toFixed(3),
    "-i",
    sourceFileName,
    "-frames:v",
    "1",
    "-q:v",
    "5",
    outputFile
  ]);
  const bytes = await ffmpeg.readFile(outputFile);
  await cleanup([outputFile]);
  return {
    dataUrl: bytesToDataUrl(bytes as Uint8Array, "image/jpeg"),
    timestampSec
  };
}

async function analyzeVideo(payload: WorkerRequest<"analyzeVideo">["payload"]): Promise<{
  durationSec: number;
  candidates: ClipCandidateDraft[];
}> {
  await ensureLoaded();
  postProgress(0.05);
  await ffmpeg.writeFile(payload.sourceFileName, payload.sourceVideo);
  const durationSec = await readDuration(payload.sourceFileName);
  const syntheticSceneMarks = Array.from(
    { length: Math.max(0, Math.floor(durationSec / 6) - 1) },
    (_, index) => Number(((index + 1) * 6).toFixed(3))
  );
  const rawCandidates = buildClipCandidateDrafts(durationSec, syntheticSceneMarks)
    .map((candidate) => ({
      ...candidate,
      heuristic: heuristicScore(candidate, durationSec)
    }))
    .sort((left, right) => right.heuristic - left.heuristic || left.startSec - right.startSec)
    .slice(0, 3)
    .sort((left, right) => left.startSec - right.startSec);
  const candidates: ClipCandidateDraft[] = [];

  for (let index = 0; index < rawCandidates.length; index += 1) {
    const candidate = rawCandidates[index]!;
    const frameTimestamps = chooseCandidateFrameTimes(candidate.startSec, candidate.durationSec);
    const frames: AnalysisFrame[] = [];
    for (let frameIndex = 0; frameIndex < frameTimestamps.length; frameIndex += 1) {
      frames.push(await extractFrame(payload.sourceFileName, frameTimestamps[frameIndex]!, index * 10 + frameIndex));
      postProgress(0.15 + ((index * frameTimestamps.length + frameIndex + 1) / (rawCandidates.length * frameTimestamps.length)) * 0.65);
    }
    candidates.push({
      clipId: candidate.clipId,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      durationSec: candidate.durationSec,
      frameTimestamps,
      frames
    });
  }

  await cleanup([payload.sourceFileName]);
  postProgress(1);
  return {
    durationSec,
    candidates
  };
}

async function extractClipFrames(payload: {
  sourceVideo: Uint8Array;
  sourceFileName: string;
  startSec: number;
  durationSec: number;
}): Promise<AnalysisFrame[]> {
  await ensureLoaded();
  await ffmpeg.writeFile(payload.sourceFileName, payload.sourceVideo);
  const frameTimestamps = chooseVoiceoverFrameTimes(payload.startSec, payload.durationSec);
  const frames: AnalysisFrame[] = [];
  for (let index = 0; index < frameTimestamps.length; index += 1) {
    frames.push(await extractFrame(payload.sourceFileName, frameTimestamps[index]!, 500 + index));
    postProgress((index + 1) / frameTimestamps.length);
  }
  await cleanup([payload.sourceFileName]);
  return frames;
}

async function buildPreviews(payload: WorkerRequest<"buildPreviews">["payload"]): Promise<
  Array<{ clipId: string; blob: Blob }>
> {
  await ensureLoaded();
  const limits = pickDeviceLimits(payload.deviceMode);
  await ffmpeg.writeFile(payload.sourceFileName, payload.sourceVideo);
  const results: Array<{ clipId: string; blob: Blob }> = [];

  for (let index = 0; index < payload.clips.length; index += 1) {
    const clip = payload.clips[index]!;
    const outputFile = `${clip.clipId}-preview.mp4`;
    await ffmpeg.exec([
      "-ss",
      clip.startSec.toFixed(3),
      "-t",
      clip.durationSec.toFixed(3),
      "-i",
      payload.sourceFileName,
      "-an",
      "-vf",
      `scale=-2:${limits.renderHeight}`,
      "-c:v",
      "libx264",
      "-preset",
      "ultrafast",
      "-pix_fmt",
      "yuv420p",
      outputFile
    ]);
    const bytes = (await ffmpeg.readFile(outputFile)) as Uint8Array;
    results.push({
      clipId: clip.clipId,
      blob: new Blob([bytes.slice()], { type: "video/mp4" })
    });
    await cleanup([outputFile]);
    postProgress((index + 1) / payload.clips.length);
  }

  await cleanup([payload.sourceFileName]);
  return results;
}

async function renderFinal(payload: WorkerRequest<"renderFinal">["payload"]): Promise<{ blob: Blob }> {
  await ensureLoaded();
  const limits = pickDeviceLimits(payload.deviceMode);
  await ffmpeg.writeFile(payload.sourceFileName, payload.sourceVideo);
  const audioFile = "voiceover.wav";
  const subtitleFile = "subtitles.srt";
  await ffmpeg.writeFile(audioFile, pcmToWav(payload.audioBytes, payload.audioMimeType));
  await ffmpeg.writeFile(subtitleFile, payload.subtitleText);
  const outputFile = "final-output.mp4";
  await ffmpeg.exec([
    "-ss",
    payload.startSec.toFixed(3),
    "-t",
    payload.durationSec.toFixed(3),
    "-i",
    payload.sourceFileName,
    "-i",
    audioFile,
    "-vf",
    `scale=-2:${limits.renderHeight},subtitles=${subtitleFile}`,
    "-map",
    "0:v:0",
    "-map",
    "1:a:0",
    "-c:v",
    "libx264",
    "-preset",
    "ultrafast",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    outputFile
  ]);
  const bytes = (await ffmpeg.readFile(outputFile)) as Uint8Array;
  await cleanup([payload.sourceFileName, audioFile, subtitleFile, outputFile]);
  postProgress(1);
  return {
    blob: new Blob([bytes.slice()], { type: "video/mp4" })
  };
}

self.onmessage = async (event: MessageEvent<WorkerRequest<WorkerCommand>>) => {
  const { requestId, command, payload } = event.data;
  try {
    let result: unknown;
    if (command === "analyzeVideo") {
      result = await analyzeVideo(payload as WorkerRequest<"analyzeVideo">["payload"]);
    } else if (command === "buildPreviews") {
      result = await buildPreviews(payload as WorkerRequest<"buildPreviews">["payload"]);
    } else if (command === "extractClipFrames") {
      result = await extractClipFrames(
        payload as WorkerRequest<"renderFinal">["payload"] & {
          sourceVideo: Uint8Array;
          sourceFileName: string;
          startSec: number;
          durationSec: number;
        }
      );
    } else {
      result = await renderFinal(payload as WorkerRequest<"renderFinal">["payload"]);
    }
    self.postMessage({
      requestId,
      type: "result",
      command,
      payload: result
    });
  } catch (error) {
    self.postMessage({
      requestId,
      type: "error",
      message: error instanceof Error ? error.message : "Worker render gagal."
    });
  }
};
