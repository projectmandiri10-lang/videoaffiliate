import type { ClipCandidate, ClipCandidateDraft } from "../types.js";

export const SHORTS_MIN_DURATION_SEC = 18;
export const SHORTS_MAX_DURATION_SEC = 32;
export const SHORTS_TARGET_DURATION_SEC = 24;
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

export function buildClipCandidateDrafts(
  durationSec: number,
  sceneChanges: number[]
): ClipCandidateWindow[] {
  if (durationSec < SHORTS_MIN_DURATION_SEC) {
    return [];
  }

  const rawStarts = [
    0,
    ...sceneChanges.filter(
      (time) => time >= MIN_START_GAP_SEC && time <= durationSec - SHORTS_MIN_DURATION_SEC
    )
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

export function pickTopNonOverlappingClipCandidates(
  candidates: ClipCandidate[],
  maxCount = 3
): ClipCandidate[] {
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
