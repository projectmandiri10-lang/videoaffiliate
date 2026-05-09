import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ffmpegPath from "ffmpeg-static";
import { getRenderProfile, resolveRenderVariant } from "../render-config.js";
import type { RenderProfileId } from "../types.js";
import { probeVideoDuration, type ProbedVideoMetadata } from "./video.js";

const FILTER_ROOT_DIR = process.cwd();
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SERVER_ROOT_DIR = path.resolve(MODULE_DIR, "..", "..");
const BUNDLED_FONT_DIR = path.join(SERVER_ROOT_DIR, "assets", "fonts");

export interface BuildRenderGraphInput {
  subtitlePath: string;
  subtitleCues?: RenderSubtitleCue[];
  targetDurationSec: number;
  videoMetadata: ProbedVideoMetadata;
  renderProfileId: RenderProfileId;
  renderVariantKey?: string;
  auditBoost?: boolean;
  titleText: string;
  ctaText: string;
}

export interface RenderVideoInput extends BuildRenderGraphInput {
  sourceVideoPath: string;
  voiceWavPath: string;
  outputVideoPath: string;
}

export interface RenderGraphPlan {
  renderProfileId: RenderProfileId;
  renderProfileLabel: string;
  variantKey: string;
  burnSubtitles: boolean;
  filterComplex: string;
}

export interface RenderSubtitleCue {
  startSec: number;
  endSec: number;
  lines: string[];
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function even(value: number): number {
  return Math.max(2, Math.floor(value / 2) * 2);
}

function resolveBundledFontPath(fontAsset: string): string {
  return path.join(BUNDLED_FONT_DIR, fontAsset);
}

function toPosixPath(filePath: string): string {
  const relative = path.relative(FILTER_ROOT_DIR, filePath);
  const candidate = relative && !relative.startsWith("\\") ? relative : filePath;
  return candidate.split(path.sep).join("/");
}

function escapeFilterPath(filePath: string): string {
  return toPosixPath(filePath)
    .replace(/\\/g, "/")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/'/g, "\\'");
}

function escapeDrawtextText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/,/g, "\\,")
    .replace(/%/g, "\\%")
    .replace(/'/g, "\\'");
}

function toOverlayColor(hexColor: string, alpha: number): string {
  return `${hexColor.replace(/^#/, "")}@${alpha.toFixed(2)}`;
}

function assColorToDrawtextColor(assColor: string): string {
  const match = assColor.trim().match(/^&H([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!match) {
    return assColor;
  }

  const alpha = Number.parseInt(match[1]!, 16);
  const blue = match[2]!;
  const green = match[3]!;
  const red = match[4]!;
  const opacity = clamp(1 - alpha / 255, 0, 1);
  return `0x${red}${green}${blue}@${opacity.toFixed(2)}`;
}

function parseSrtTimestamp(input: string): number | undefined {
  const match = input.trim().match(/^(\d{2}):(\d{2}):(\d{2}),(\d{3})$/);
  if (!match) {
    return undefined;
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3]);
  const millis = Number(match[4]);
  if (![hours, minutes, seconds, millis].every(Number.isFinite)) {
    return undefined;
  }
  return hours * 3600 + minutes * 60 + seconds + millis / 1000;
}

function parseSrtCues(srtText: string): RenderSubtitleCue[] {
  return srtText
    .split(/\r?\n\s*\r?\n/)
    .map((block) => block.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))
    .map((lines): RenderSubtitleCue | undefined => {
      const timingLine = lines.find((line) => line.includes("-->"));
      if (!timingLine) {
        return undefined;
      }

      const timingIndex = lines.indexOf(timingLine);
      const [startRaw, endRaw] = timingLine.split("-->").map((part) => part.trim());
      const startSec = startRaw ? parseSrtTimestamp(startRaw) : undefined;
      const endSec = endRaw ? parseSrtTimestamp(endRaw.split(/\s+/)[0] ?? "") : undefined;
      const textLines = lines.slice(timingIndex + 1).filter((line) => line.length > 0);
      if (
        startSec === undefined ||
        endSec === undefined ||
        endSec <= startSec ||
        textLines.length === 0
      ) {
        return undefined;
      }

      return {
        startSec,
        endSec,
        lines: textLines.slice(0, 2)
      };
    })
    .filter((cue): cue is RenderSubtitleCue => Boolean(cue));
}

function wrapText(input: string, maxChars: number, maxLines: number): string[] {
  const words = input.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= maxChars) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
    }
    current = word;
    if (lines.length === maxLines) {
      break;
    }
  }

  if (current && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    return lines.slice(0, maxLines);
  }

  const usedWords = lines.join(" ").split(" ").filter(Boolean).length;
  if (usedWords < words.length && lines.length > 0) {
    const lastIndex = lines.length - 1;
    const trimmed = lines[lastIndex]!.slice(0, Math.max(1, maxChars - 1)).trim();
    lines[lastIndex] = `${trimmed}...`;
  }

  return lines;
}

function buildAtempoFilter(targetFactor: number): string {
  let factor = Math.max(0.25, Math.min(4, targetFactor));
  const filters: string[] = [];

  while (factor > 2) {
    filters.push("atempo=2");
    factor /= 2;
  }
  while (factor < 0.5) {
    filters.push("atempo=0.5");
    factor /= 0.5;
  }
  filters.push(`atempo=${factor.toFixed(6)}`);
  return filters.join(",");
}

function buildCropFilters(
  metadata: ProbedVideoMetadata,
  cropZoom: number,
  anchorX: number,
  anchorY: number,
  auditBoost = false
): string[] {
  const effectiveCropZoom = auditBoost ? Math.max(cropZoom + 0.055, 1.07) : cropZoom;
  if (effectiveCropZoom <= 1) {
    return ["setpts=PTS-STARTPTS"];
  }

  const outputWidth = even(metadata.displayWidth);
  const outputHeight = even(metadata.displayHeight);
  const cropWidth = even(outputWidth / effectiveCropZoom);
  const cropHeight = even(outputHeight / effectiveCropZoom);
  const x = even(
    clamp((outputWidth - cropWidth) * anchorX, 0, Math.max(0, outputWidth - cropWidth))
  );
  const y = even(
    clamp((outputHeight - cropHeight) * anchorY, 0, Math.max(0, outputHeight - cropHeight))
  );

  return [
    "setpts=PTS-STARTPTS",
    `crop=${cropWidth}:${cropHeight}:${x}:${y}`,
    `scale=${outputWidth}:${outputHeight}`
  ];
}

function buildEqFilter(profileId: RenderProfileId, auditBoost = false): string | undefined {
  const profile = getRenderProfile(profileId);
  const brightness = profile.color.brightness + (auditBoost && profileId !== "native_source" ? 0.012 : 0);
  const contrast = profile.color.contrast + (auditBoost && profileId !== "native_source" ? 0.035 : 0);
  const saturation = profile.color.saturation + (auditBoost && profileId !== "native_source" ? 0.045 : 0);
  if (
    brightness === 0 &&
    contrast === 1 &&
    saturation === 1 &&
    !profile.color.gamma
  ) {
    return undefined;
  }

  const parts = [
    `brightness=${brightness.toFixed(3)}`,
    `contrast=${contrast.toFixed(3)}`,
    `saturation=${saturation.toFixed(3)}`
  ];
  if (profile.color.gamma) {
    parts.push(`gamma=${profile.color.gamma.toFixed(3)}`);
  }
  return `eq=${parts.join(":")}`;
}

function buildUnsharpFilter(profileId: RenderProfileId, auditBoost = false): string | undefined {
  const profile = getRenderProfile(profileId);
  const sharpenAmount =
    profile.sharpenAmount + (auditBoost && profileId !== "native_source" ? 0.28 : 0);
  if (sharpenAmount <= 0) {
    return undefined;
  }
  return `unsharp=5:5:${sharpenAmount.toFixed(2)}:5:5:0.00`;
}

function getSubtitleThemeOrThrow(profileId: RenderProfileId) {
  const theme = getRenderProfile(profileId).subtitleTheme;
  if (!theme) {
    throw new Error(`Subtitle theme untuk profile ${profileId} belum dikonfigurasi.`);
  }
  return theme;
}

function getTextThemeOrThrow(profileId: RenderProfileId) {
  const theme = getRenderProfile(profileId).textTheme;
  if (!theme) {
    throw new Error(`Text theme untuk profile ${profileId} belum dikonfigurasi.`);
  }
  return theme;
}

function buildSubtitleFilter(
  profileId: RenderProfileId,
  subtitlePath: string,
  marginV: number,
  fontSize: number
): string {
  const theme = getSubtitleThemeOrThrow(profileId);
  const style = [
    `FontName=${theme.fontFamily}`,
    `FontSize=${fontSize}`,
    `PrimaryColour=${theme.primaryColor}`,
    `OutlineColour=${theme.outlineColor}`,
    `BackColour=${theme.backColor}`,
    `BorderStyle=${theme.borderStyle}`,
    `Outline=${theme.outline}`,
    `Shadow=${theme.shadow}`,
    `MarginV=${marginV}`,
    `Alignment=${theme.alignment}`,
    theme.scaleX ? `ScaleX=${theme.scaleX}` : undefined
  ]
    .filter(Boolean)
    .join(",");

  return `subtitles='${escapeFilterPath(subtitlePath)}':fontsdir='${escapeFilterPath(
    BUNDLED_FONT_DIR
  )}':force_style='${style}'`;
}

function buildSubtitleDrawtextFilters(
  input: BuildRenderGraphInput,
  marginV: number,
  fontSize: number
): string[] {
  const cues = input.subtitleCues ?? [];
  if (cues.length === 0) {
    return [];
  }

  const theme = getSubtitleThemeOrThrow(input.renderProfileId);
  const fontPath = resolveBundledFontPath(theme.fontAsset);
  const fontColor = assColorToDrawtextColor(theme.primaryColor);
  const boxColor = assColorToDrawtextColor(theme.backColor);
  const borderColor = assColorToDrawtextColor(theme.outlineColor);
  const boosted = Boolean(input.auditBoost && input.renderProfileId !== "native_source");
  const lineHeight = Math.max(fontSize + 8, Math.round(fontSize * (boosted ? 1.32 : 1.24)));
  const boxBorderWidth = Math.max(10, Math.round(fontSize * (boosted ? 0.42 : 0.28)));
  const borderWidth = Math.max(2, Math.round(theme.outline + (boosted ? 1.2 : 0)));

  return cues.flatMap((cue) => {
    const safeStart = Math.max(0, cue.startSec);
    const safeEnd = Math.max(safeStart + 0.05, cue.endSec);
    const cueLines = cue.lines.slice(0, 2);
    return cueLines.map((line, index) => {
      const lineOffset = marginV + (cueLines.length - 1 - index) * lineHeight;
      return `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
        line
      )}':fontcolor=${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=h-${lineOffset}-text_h:box=1:boxcolor=${boxColor}:boxborderw=${boxBorderWidth}:borderw=${borderWidth}:bordercolor=${borderColor}:enable='between(t,${safeStart.toFixed(
        3
      )},${safeEnd.toFixed(3)})'`;
    });
  });
}

function buildIntroFilters(
  input: BuildRenderGraphInput,
  accentColor: string,
  kicker: string
): string[] {
  const duration = clamp(
    Math.min(
      getRenderProfile(input.renderProfileId).introDurationSec,
      input.targetDurationSec * 0.22
    ),
    0,
    input.targetDurationSec * 0.4
  );
  if (duration <= 0.1) {
    return [];
  }

  const overlayHeight = even(Math.max(180, input.videoMetadata.displayHeight * 0.28));
  const kickerSize = Math.max(26, Math.round(input.videoMetadata.displayHeight * 0.028));
  const titleSize = Math.max(34, Math.round(input.videoMetadata.displayHeight * 0.043));
  const titleLines = wrapText(input.titleText, 28, 2);
  const startY = Math.round(input.videoMetadata.displayHeight * 0.11);
  const textTheme = getTextThemeOrThrow(input.renderProfileId);
  const fontPath = resolveBundledFontPath(textTheme.fontAsset);

  const filters = [
    `drawbox=x=0:y=0:w=iw:h=${overlayHeight}:color=${toOverlayColor(accentColor, 0.82)}:t=fill:enable='between(t,0,${duration.toFixed(3)})'`,
    `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
      kicker
    )}':fontcolor=${textTheme.fontColor}:fontsize=${kickerSize}:x=(w-text_w)/2:y=${startY}:enable='between(t,0,${duration.toFixed(
      3
    )})'`
  ];

  titleLines.forEach((line, index) => {
    filters.push(
      `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
        line
      )}':fontcolor=${textTheme.fontColor}:fontsize=${titleSize}:x=(w-text_w)/2:y=${startY + kickerSize + 18 + index * (titleSize + 10)}:enable='between(t,0,${duration.toFixed(
        3
      )})'`
    );
  });

  return filters;
}

function buildOutroFilters(
  input: BuildRenderGraphInput,
  accentColor: string
): string[] {
  const profile = getRenderProfile(input.renderProfileId);
  const duration = clamp(
    Math.min(profile.outroDurationSec, input.targetDurationSec * 0.24),
    0,
    input.targetDurationSec * 0.45
  );
  if (duration <= 0.1) {
    return [];
  }

  const start = Math.max(0, input.targetDurationSec - duration);
  const overlayHeight = even(Math.max(190, input.videoMetadata.displayHeight * 0.24));
  const overlayY = input.videoMetadata.displayHeight - overlayHeight;
  const labelSize = Math.max(28, Math.round(input.videoMetadata.displayHeight * 0.032));
  const ctaSize = Math.max(34, Math.round(input.videoMetadata.displayHeight * 0.039));
  const ctaLines = wrapText(
    input.ctaText.trim() || profile.ctaOverlayText,
    input.renderProfileId === "facebook_story" ? 32 : 28,
    2
  );
  const startY = overlayY + Math.round(overlayHeight * 0.22);
  const textTheme = getTextThemeOrThrow(input.renderProfileId);
  const fontPath = resolveBundledFontPath(textTheme.fontAsset);

  const filters = [
    `drawbox=x=0:y=${overlayY}:w=iw:h=${overlayHeight}:color=${toOverlayColor(accentColor, 0.86)}:t=fill:enable='between(t,${start.toFixed(
      3
    )},${input.targetDurationSec.toFixed(3)})'`,
    `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
      "CTA PLATFORM"
    )}':fontcolor=${textTheme.fontColor}:fontsize=${labelSize}:x=(w-text_w)/2:y=${startY}:enable='between(t,${start.toFixed(
      3
    )},${input.targetDurationSec.toFixed(3)})'`
  ];

  ctaLines.forEach((line, index) => {
    filters.push(
      `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
        line
      )}':fontcolor=${textTheme.fontColor}:fontsize=${ctaSize}:x=(w-text_w)/2:y=${startY + labelSize + 16 + index * (ctaSize + 8)}:enable='between(t,${start.toFixed(
        3
      )},${input.targetDurationSec.toFixed(3)})'`
    );
  });

  return filters;
}

function buildMidBadgeFilters(input: BuildRenderGraphInput, accentColor: string): string[] {
  const profile = getRenderProfile(input.renderProfileId);
  if (!profile.midBadgeText) {
    return [];
  }

  const badgeStart = Math.max(profile.introDurationSec + 0.4, input.targetDurationSec * 0.58);
  const badgeEnd = Math.max(
    badgeStart + 0.5,
    input.targetDurationSec - profile.outroDurationSec - 0.2
  );
  if (badgeEnd - badgeStart < 0.35) {
    return [];
  }

  const fontSize = Math.max(24, Math.round(input.videoMetadata.displayHeight * 0.029));
  const boxWidth = Math.max(220, Math.round(input.videoMetadata.displayWidth * 0.22));
  const boxHeight = Math.max(72, Math.round(input.videoMetadata.displayHeight * 0.075));
  const boxX = Math.round(
    input.videoMetadata.displayWidth - boxWidth - input.videoMetadata.displayWidth * 0.06
  );
  const boxY = Math.round(input.videoMetadata.displayHeight * 0.14);
  const textTheme = getTextThemeOrThrow(input.renderProfileId);
  const fontPath = resolveBundledFontPath(textTheme.fontAsset);

  return [
    `drawbox=x=${boxX}:y=${boxY}:w=${boxWidth}:h=${boxHeight}:color=${toOverlayColor(accentColor, 0.90)}:t=fill:enable='between(t,${badgeStart.toFixed(
      3
    )},${badgeEnd.toFixed(3)})'`,
    `drawtext=fontfile='${escapeFilterPath(fontPath)}':text='${escapeDrawtextText(
      profile.midBadgeText
    )}':fontcolor=${textTheme.fontColor}:fontsize=${fontSize}:x=${boxX}+((${boxWidth})-text_w)/2:y=${boxY}+((${boxHeight})-text_h)/2:enable='between(t,${badgeStart.toFixed(
      3
    )},${badgeEnd.toFixed(3)})'`
  ];
}

function buildAuditBoostFilters(input: BuildRenderGraphInput, accentColor: string): string[] {
  if (!input.auditBoost || input.renderProfileId === "native_source") {
    return [];
  }

  const stripeWidth = Math.max(18, Math.round(input.videoMetadata.displayWidth * 0.025));
  const bottomHeight = Math.max(16, Math.round(input.videoMetadata.displayHeight * 0.018));
  const opacity =
    input.renderProfileId === "facebook_story"
      ? 0.26
      : input.renderProfileId === "shopee_sales"
        ? 0.34
        : 0.24;

  return [
    `drawbox=x=0:y=0:w=${stripeWidth}:h=ih:color=${toOverlayColor(accentColor, opacity)}:t=fill`,
    `drawbox=x=0:y=ih-${bottomHeight}:w=iw:h=${bottomHeight}:color=${toOverlayColor(
      accentColor,
      opacity + 0.08
    )}:t=fill`
  ];
}

function buildVideoFilters(input: BuildRenderGraphInput): string[] {
  const profile = getRenderProfile(input.renderProfileId);
  const variant = resolveRenderVariant(input.renderProfileId, input.renderVariantKey);
  const filters = buildCropFilters(
    input.videoMetadata,
    variant.cropZoom,
    variant.anchorX,
    variant.anchorY,
    Boolean(input.auditBoost && input.renderProfileId !== "native_source")
  );

  const eqFilter = buildEqFilter(input.renderProfileId, input.auditBoost);
  if (eqFilter) {
    filters.push(eqFilter);
  }
  const unsharpFilter = buildUnsharpFilter(input.renderProfileId, input.auditBoost);
  if (unsharpFilter) {
    filters.push(unsharpFilter);
  }

  const subtitleFilters: string[] = [];
  if (profile.burnSubtitles) {
    const subtitleTheme = getSubtitleThemeOrThrow(input.renderProfileId);
    const fontSize = Math.max(
      subtitleTheme.minFontSize,
      Math.round(input.videoMetadata.displayHeight * subtitleTheme.fontSizeRatio)
    );
    const marginV = Math.max(
      subtitleTheme.minMarginV,
      Math.round(
        input.videoMetadata.displayHeight *
          Math.max(subtitleTheme.marginVRatio, variant.subtitleMarginVRatio)
      )
    );
    const drawtextSubtitleFilters = buildSubtitleDrawtextFilters(input, marginV, fontSize);
    subtitleFilters.push(
      ...(drawtextSubtitleFilters.length > 0
        ? drawtextSubtitleFilters
        : [buildSubtitleFilter(input.renderProfileId, input.subtitlePath, marginV, fontSize)])
    );
  }

  if (input.renderProfileId !== "native_source") {
    filters.push(...buildIntroFilters(input, profile.introAccent, profile.introKicker));
    filters.push(...buildMidBadgeFilters(input, profile.introAccent));
    filters.push(...buildOutroFilters(input, profile.outroAccent));
    filters.push(...buildAuditBoostFilters(input, profile.introAccent));
  }

  filters.push(...subtitleFilters);

  return filters;
}

async function ensureBundledFontAvailable(profileId: RenderProfileId): Promise<void> {
  const profile = getRenderProfile(profileId);
  const fontAssets = new Set<string>();
  if (profile.subtitleTheme?.fontAsset) {
    fontAssets.add(profile.subtitleTheme.fontAsset);
  }
  if (profile.textTheme?.fontAsset) {
    fontAssets.add(profile.textTheme.fontAsset);
  }

  for (const fontAsset of fontAssets) {
    const fontPath = resolveBundledFontPath(fontAsset);
    try {
      await access(fontPath);
    } catch {
      throw new Error(
        `Font render tidak ditemukan (${fontPath}). Pastikan aset font server tersedia.`
      );
    }
  }
}

async function runFfmpeg(args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(FFMPEG_EXEC, args, {
      windowsHide: true,
      cwd: FILTER_ROOT_DIR
    });
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
        reject(new Error(`ffmpeg gagal merender video: ${stderr || code}`));
        return;
      }
      resolve();
    });
  });
}

export function buildRenderGraph(input: BuildRenderGraphInput): RenderGraphPlan {
  const profile = getRenderProfile(input.renderProfileId);
  const variant = resolveRenderVariant(input.renderProfileId, input.renderVariantKey);
  const videoFilters = buildVideoFilters({
    ...input,
    renderVariantKey: variant.key
  });

  return {
    renderProfileId: profile.id,
    renderProfileLabel: profile.label,
    variantKey: variant.key,
    burnSubtitles: profile.burnSubtitles,
    filterComplex: videoFilters.join(",")
  };
}

export async function renderPlatformVideo(input: RenderVideoInput): Promise<RenderGraphPlan> {
  const profile = getRenderProfile(input.renderProfileId);
  if (input.renderProfileId !== "native_source" || profile.burnSubtitles) {
    await ensureBundledFontAvailable(input.renderProfileId);
  }

  const subtitleCues =
    input.renderProfileId !== "native_source" && profile.burnSubtitles
      ? parseSrtCues(await readFile(input.subtitlePath, "utf8"))
      : undefined;
  if (profile.burnSubtitles && (!subtitleCues || subtitleCues.length === 0)) {
    throw new Error(
      `Subtitle render untuk profile ${input.renderProfileId} kosong atau tidak valid.`
    );
  }
  const graph = buildRenderGraph({
    ...input,
    subtitleCues
  });
  const safeTargetDurationSec = Math.max(1, input.targetDurationSec);
  const voiceDurationSec = await probeVideoDuration(input.voiceWavPath);
  const durationDiff = Math.abs(voiceDurationSec - safeTargetDurationSec);
  const tempoFactor = voiceDurationSec / safeTargetDurationSec;
  const tempoFilter = durationDiff > 0.12 ? `${buildAtempoFilter(tempoFactor)},` : "";
  const targetDurationText = safeTargetDurationSec.toFixed(3);
  const audioFilter = `${tempoFilter}atrim=0:${targetDurationText},apad=pad_dur=${targetDurationText}`;

  await runFfmpeg([
    "-y",
    "-i",
    input.sourceVideoPath,
    "-i",
    input.voiceWavPath,
    "-filter_complex",
    `[0:v]${graph.filterComplex}[vout];[1:a]${audioFilter}[aout]`,
    "-map",
    "[vout]",
    "-map",
    "[aout]",
    "-c:v",
    "libx264",
    "-preset",
    "veryfast",
    "-crf",
    "23",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-ar",
    "24000",
    "-ac",
    "1",
    "-movflags",
    "+faststart",
    "-t",
    targetDurationText,
    input.outputVideoPath
  ]);

  return graph;
}
