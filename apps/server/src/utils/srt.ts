import type { SubtitleStyle } from "../types.js";

interface CueDraft {
  text: string;
  lines: string[];
  words: number;
}

export interface TimedCue extends CueDraft {
  startMs: number;
  endMs: number;
}

interface SubtitleProfile {
  targetLine: number;
  maxLine: number;
  maxBlock: number;
  minCueDurationSec: number;
  maxCueDurationSec: number;
}

const SUBTITLE_PROFILES: Record<SubtitleStyle, SubtitleProfile> = {
  short_punchy: {
    targetLine: 20,
    maxLine: 26,
    maxBlock: 44,
    minCueDurationSec: 0.8,
    maxCueDurationSec: 2.2
  },
  clear: {
    targetLine: 38,
    maxLine: 42,
    maxBlock: 80,
    minCueDurationSec: 1,
    maxCueDurationSec: 4
  },
  narrative: {
    targetLine: 32,
    maxLine: 38,
    maxBlock: 88,
    minCueDurationSec: 1.2,
    maxCueDurationSec: 4.2
  },
  sales: {
    targetLine: 24,
    maxLine: 30,
    maxBlock: 52,
    minCueDurationSec: 0.8,
    maxCueDurationSec: 2.6
  }
};

function normalizeWhitespace(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function countWords(input: string): number {
  const normalized = normalizeWhitespace(input);
  if (!normalized) {
    return 0;
  }
  return normalized.split(" ").length;
}

function chunkScript(script: string, profile: SubtitleProfile): string[] {
  const words = normalizeWhitespace(script).split(" ").filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= profile.maxBlock) {
      current = candidate;
      continue;
    }
    if (current) {
      chunks.push(current);
    }
    current = word;
  }
  if (current) {
    chunks.push(current);
  }
  return chunks;
}

function findNearestSplit(text: string, target: number): number {
  let best = -1;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 1; i < text.length - 1; i += 1) {
    if (text[i] !== " ") {
      continue;
    }
    const distance = Math.abs(i - target);
    if (distance < bestDistance) {
      best = i;
      bestDistance = distance;
    }
  }
  return best;
}

function splitInHalf(text: string): [string, string] {
  const normalized = normalizeWhitespace(text);
  const splitIndex = findNearestSplit(normalized, Math.floor(normalized.length / 2));
  if (splitIndex < 0) {
    const middle = Math.floor(normalized.length / 2);
    return [normalized.slice(0, middle).trim(), normalized.slice(middle).trim()];
  }
  return [
    normalized.slice(0, splitIndex).trim(),
    normalized.slice(splitIndex + 1).trim()
  ];
}

function enforceCueCount(
  chunks: string[],
  totalDurationSec: number,
  profile: SubtitleProfile
): string[] {
  const minCount = Math.max(1, Math.ceil(totalDurationSec / profile.maxCueDurationSec));
  const maxCount = Math.max(1, Math.floor(totalDurationSec / profile.minCueDurationSec));
  let next = [...chunks];

  while (next.length < minCount) {
    const index = next
      .map((text, i) => ({ i, len: text.length }))
      .sort((a, b) => b.len - a.len)[0]?.i;
    if (index === undefined) {
      break;
    }
    const selected = next[index];
    if (!selected) {
      break;
    }
    const [left, right] = splitInHalf(selected);
    if (!left || !right) {
      break;
    }
    next.splice(index, 1, left, right);
  }

  while (next.length > maxCount && next.length > 1) {
    const index = next
      .map((text, i) => ({ i, len: text.length }))
      .sort((a, b) => a.len - b.len)[0]?.i;
    if (index === undefined) {
      break;
    }
    const neighborIndex = index === 0 ? 1 : index - 1;
    const merged = `${next[neighborIndex] ?? ""} ${next[index] ?? ""}`.trim();
    next[neighborIndex] = merged;
    next.splice(index, 1);
  }

  return next;
}

function wrapTwoLines(text: string, profile: SubtitleProfile): string[] {
  const normalized = normalizeWhitespace(text);
  if (normalized.length <= profile.maxLine) {
    return [normalized];
  }

  const splitIndex = findNearestSplit(normalized, profile.targetLine);
  if (splitIndex < 0) {
    return [
      normalized.slice(0, profile.maxLine).trim(),
      normalized.slice(profile.maxLine).trim()
    ].filter(Boolean);
  }

  const first = normalized.slice(0, splitIndex).trim();
  const second = normalized.slice(splitIndex + 1).trim();
  if (first.length <= profile.maxLine && second.length <= profile.maxLine) {
    return [first, second];
  }

  return [
    normalized.slice(0, profile.maxLine).trim(),
    normalized.slice(profile.maxLine).trim()
  ].filter(Boolean);
}

function createDrafts(
  script: string,
  totalDurationSec: number,
  profile: SubtitleProfile
): CueDraft[] {
  const chunks = enforceCueCount(chunkScript(script, profile), totalDurationSec, profile);
  return chunks.map((chunk) => ({
    text: chunk,
    lines: wrapTwoLines(chunk, profile).slice(0, 2),
    words: Math.max(1, countWords(chunk))
  }));
}

function distributeDurations(
  drafts: CueDraft[],
  totalDurationSec: number,
  profile: SubtitleProfile
): number[] {
  const totalWords = drafts.reduce((sum, draft) => sum + draft.words, 0);
  let durations = drafts.map((draft) => (totalDurationSec * draft.words) / totalWords);
  durations = durations.map((value) =>
    Math.max(profile.minCueDurationSec, Math.min(profile.maxCueDurationSec, value))
  );

  let diff = totalDurationSec - durations.reduce((sum, value) => sum + value, 0);
  let guard = 0;
  while (Math.abs(diff) > 0.001 && guard < 5000) {
    guard += 1;
    if (diff > 0) {
      const expandable = durations
        .map((value, index) => ({ index, room: profile.maxCueDurationSec - value }))
        .filter((item) => item.room > 0);
      if (expandable.length === 0) {
        break;
      }
      const roomSum = expandable.reduce((sum, item) => sum + item.room, 0);
      for (const item of expandable) {
        const add = Math.min(item.room, (diff * item.room) / roomSum);
        durations[item.index] = (durations[item.index] ?? profile.minCueDurationSec) + add;
        diff -= add;
      }
    } else {
      const shrinkable = durations
        .map((value, index) => ({ index, room: value - profile.minCueDurationSec }))
        .filter((item) => item.room > 0);
      if (shrinkable.length === 0) {
        break;
      }
      const roomSum = shrinkable.reduce((sum, item) => sum + item.room, 0);
      for (const item of shrinkable) {
        const remove = Math.min(item.room, (Math.abs(diff) * item.room) / roomSum);
        durations[item.index] = (durations[item.index] ?? profile.minCueDurationSec) - remove;
        diff += remove;
      }
    }
  }

  if (Math.abs(diff) > 0.001) {
    const lastIndex = durations.length - 1;
    const current = durations[lastIndex] ?? profile.minCueDurationSec;
    durations[lastIndex] = Math.max(
      profile.minCueDurationSec,
      Math.min(profile.maxCueDurationSec, current + diff)
    );
  }

  return durations;
}

export function buildTimedCues(
  script: string,
  totalDurationSec: number,
  subtitleStyle: SubtitleStyle = "clear"
): TimedCue[] {
  const cleaned = normalizeWhitespace(script);
  if (!cleaned) {
    return [];
  }

  const profile = SUBTITLE_PROFILES[subtitleStyle];
  const drafts = createDrafts(cleaned, totalDurationSec, profile);
  if (!drafts.length) {
    return [];
  }

  const durations = distributeDurations(drafts, totalDurationSec, profile);
  let cursor = 0;
  return drafts.map((draft, index) => {
    const duration = (durations[index] ?? 1) * 1000;
    const startMs = Math.round(cursor);
    cursor += duration;
    const endMs =
      index === drafts.length - 1
        ? Math.round(totalDurationSec * 1000)
        : Math.round(cursor);
    return {
      ...draft,
      startMs,
      endMs
    };
  });
}

export function formatSrtTimestamp(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const hours = Math.floor(totalMs / 3_600_000);
  const minutes = Math.floor((totalMs % 3_600_000) / 60_000);
  const seconds = Math.floor((totalMs % 60_000) / 1_000);
  const millis = totalMs % 1_000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(
    seconds
  ).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(
  script: string,
  totalDurationSec: number,
  subtitleStyle: SubtitleStyle = "clear"
): string {
  const cues = buildTimedCues(script, totalDurationSec, subtitleStyle);
  return cues
    .map((cue, index) => {
      const text = cue.lines.join("\n");
      return `${index + 1}\n${formatSrtTimestamp(cue.startMs)} --> ${formatSrtTimestamp(
        cue.endMs
      )}\n${text}\n`;
    })
    .join("\n");
}
