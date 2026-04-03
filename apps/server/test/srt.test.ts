import { describe, expect, it } from "vitest";
import { buildSrt, buildTimedCues, formatSrtTimestamp } from "../src/utils/srt.js";

const LONG_SCRIPT =
  "Produk ini bantu rutinitas harian lebih praktis, cepat, dan nyaman dipakai kapan saja. Cocok untuk pengguna yang butuh solusi simpel tanpa ribet, dengan hasil yang tetap terasa relevan untuk kebutuhan sehari-hari.";

describe("srt utils", () => {
  it("formats timestamp correctly", () => {
    expect(formatSrtTimestamp(3723456)).toBe("01:02:03,456");
  });

  it("builds clear profile cues inside total duration", () => {
    const cues = buildTimedCues(LONG_SCRIPT, 12, "clear");
    expect(cues.length).toBeGreaterThan(0);
    expect(cues[0]?.startMs).toBe(0);
    expect(cues[cues.length - 1]?.endMs).toBe(12000);
    for (const cue of cues) {
      expect(cue.lines.length).toBeLessThanOrEqual(2);
      for (const line of cue.lines) {
        expect(line.length).toBeLessThanOrEqual(42);
      }
      expect(cue.endMs - cue.startMs).toBeGreaterThan(0);
    }
  });

  it("uses denser chunks for short punchy profile than narrative", () => {
    const shortPunchy = buildTimedCues(LONG_SCRIPT, 12, "short_punchy");
    const narrative = buildTimedCues(LONG_SCRIPT, 12, "narrative");

    expect(shortPunchy.length).toBeGreaterThanOrEqual(narrative.length);
    for (const cue of shortPunchy) {
      for (const line of cue.lines) {
        expect(line.length).toBeLessThanOrEqual(26);
      }
    }
  });

  it("outputs valid srt blocks for sales profile", () => {
    const srt = buildSrt("Tes singkat untuk subtitle sales.", 4, "sales");
    expect(srt).toContain("1");
    expect(srt).toContain("-->");
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3}/);
  });
});
