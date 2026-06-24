import type { ClipCandidate, ClipCandidateDraft } from "./types.js";

export const SHORTS_MIN_DURATION_SEC = 18;
export const SHORTS_MAX_DURATION_SEC = 30;
export const SHORTS_TARGET_DURATION_SEC = 23;
const MIN_START_GAP_SEC = 4;
const MAX_CANDIDATE_POOL = 8;

type ClipCandidateWindow = Omit<ClipCandidateDraft, "frames">;

function roundTime(value: number): number {
  return Number(value.toFixed(3));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function chooseWindowEnd(durationSec: number, startSec: number, sceneChanges: number[]): number {
  const minEnd = startSec + SHORTS_MIN_DURATION_SEC;
  const maxEnd = Math.min(durationSec, startSec + SHORTS_MAX_DURATION_SEC);
  if (maxEnd <= minEnd) {
    return maxEnd;
  }
  const preferredEnd = Math.min(durationSec, startSec + SHORTS_TARGET_DURATION_SEC);
  const inRangeScenes = sceneChanges.filter((time) => time >= minEnd && time <= maxEnd);
  if (!inRangeScenes.length) {
    return roundTime(clamp(preferredEnd, minEnd, maxEnd));
  }
  const bestScene = inRangeScenes.reduce((best, current) =>
    Math.abs(current - preferredEnd) < Math.abs(best - preferredEnd) ? current : best
  );
  return roundTime(bestScene);
}

function isOverlapping(
  first: Pick<ClipCandidateDraft, "startSec" | "endSec">,
  second: Pick<ClipCandidateDraft, "startSec" | "endSec">
): boolean {
  return first.startSec < second.endSec && second.startSec < first.endSec;
}

export function buildClipCandidateDrafts(durationSec: number, sceneChanges: number[]): ClipCandidateWindow[] {
  if (durationSec < SHORTS_MIN_DURATION_SEC) {
    return [];
  }
  const fallbackMarks = Array.from({ length: Math.max(0, Math.floor(durationSec / 6) - 1) }, (_, index) => (index + 1) * 6);
  const rawStarts = [
    0,
    ...sceneChanges.filter((time) => time >= MIN_START_GAP_SEC && time <= durationSec - SHORTS_MIN_DURATION_SEC),
    ...fallbackMarks.filter((time) => time >= MIN_START_GAP_SEC && time <= durationSec - SHORTS_MIN_DURATION_SEC)
  ];
  const starts: number[] = [];
  for (const time of rawStarts.sort((a, b) => a - b)) {
    if (!starts.length || time - starts[starts.length - 1]! >= MIN_START_GAP_SEC) {
      starts.push(roundTime(time));
    }
  }

  const unique = new Set<string>();
  const drafts = starts
    .map<ClipCandidateWindow | undefined>((startSec, index) => {
      const endSec = chooseWindowEnd(durationSec, startSec, sceneChanges);
      const clipDurationSec = roundTime(endSec - startSec);
      if (clipDurationSec < SHORTS_MIN_DURATION_SEC || clipDurationSec > SHORTS_MAX_DURATION_SEC) {
        return undefined;
      }
      const key = `${startSec}:${endSec}`;
      if (unique.has(key)) {
        return undefined;
      }
      unique.add(key);
      return {
        clipId: `clip_${index + 1}`,
        startSec,
        endSec,
        durationSec: clipDurationSec,
        frameTimestamps: [] as number[]
      };
    })
    .filter((item): item is ClipCandidateWindow => Boolean(item));

  if (drafts.length === 0) {
    return [
      {
        clipId: "clip_1",
        startSec: 0,
        endSec: roundTime(Math.min(durationSec, SHORTS_TARGET_DURATION_SEC)),
        durationSec: roundTime(Math.min(durationSec, SHORTS_TARGET_DURATION_SEC)),
        frameTimestamps: []
      }
    ];
  }
  return drafts.slice(0, MAX_CANDIDATE_POOL);
}

export function pickTopNonOverlappingClipCandidates(candidates: ClipCandidate[], maxCount = 3): ClipCandidate[] {
  const selected: ClipCandidate[] = [];
  const sorted = [...candidates].sort(
    (a, b) => b.score - a.score || a.startSec - b.startSec || a.durationSec - b.durationSec
  );

  for (const candidate of sorted) {
    if (selected.some((item) => isOverlapping(item, candidate))) {
      continue;
    }
    selected.push(candidate);
    if (selected.length >= maxCount) {
      break;
    }
  }

  return selected.sort((a, b) => a.startSec - b.startSec);
}

function clampScore(score: number): number {
  return Number(Math.min(10, Math.max(0, score)).toFixed(2));
}

export function heuristicScore(
  candidate: Pick<ClipCandidate, "startSec" | "durationSec">,
  durationSec: number
): number {
  const relativeStart = candidate.startSec / Math.max(durationSec, 1);
  const durationOffset = Math.abs(candidate.durationSec - SHORTS_TARGET_DURATION_SEC);
  const hookBias =
    candidate.startSec <= 2
      ? 1.1
      : candidate.startSec <= 6
        ? 0.7
        : candidate.startSec <= 10
          ? 0.25
          : -0.15;
  const lateStartPenalty =
    relativeStart >= 0.65 ? 1.6 : relativeStart >= 0.52 ? 1.05 : relativeStart >= 0.38 ? 0.45 : 0;
  const durationBias =
    candidate.durationSec >= 22 && candidate.durationSec <= 27
      ? 0.75
      : candidate.durationSec >= 20 && candidate.durationSec <= 29
        ? 0.35
        : -0.35;
  const durationPenalty = durationOffset * 0.16;
  return clampScore(7.5 + hookBias + durationBias - durationPenalty - lateStartPenalty);
}

export function finalizeShortsScore(
  candidate: Pick<ClipCandidate, "startSec" | "durationSec">,
  durationSec: number,
  aiScore: number
): number {
  const heuristic = heuristicScore(candidate, durationSec);
  if (!Number.isFinite(aiScore) || aiScore <= 0) {
    return heuristic;
  }
  const relativeStart = candidate.startSec / Math.max(durationSec, 1);
  const blendedScore = aiScore * 0.72 + heuristic * 0.28;
  const earlyHookBoost = candidate.startSec <= 3 ? 0.25 : 0;
  const ctaRunwayBoost = candidate.durationSec >= 22 && candidate.durationSec <= 27 ? 0.2 : 0;
  const lateHookPenalty = relativeStart >= 0.55 ? 0.55 : relativeStart >= 0.42 ? 0.2 : 0;
  return clampScore(blendedScore + earlyHookBoost + ctaRunwayBoost - lateHookPenalty);
}
