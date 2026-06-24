import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { buildClipSelectionPrompt, buildScriptPrompt } from "../src/services/prompt-builder.js";

describe("prompt builder", () => {
  it("injects youtube-shorts-specific prompt instructions", () => {
    const prompt = buildScriptPrompt({
      settings: DEFAULT_SETTINGS,
      platformId: "youtube",
      title: "Serum pencerah wajah",
      description: "Serum dengan niacinamide untuk bantu mencerahkan kulit kusam.",
      videoDurationSec: 20,
      ctaText: "cek link produk di deskripsi untuk lihat detail lengkapnya"
    });

    expect(prompt).toContain("Kalimat pertama wajib menjadi hook kuat");
    expect(prompt).toContain("Platform target: YouTube Shorts");
    expect(prompt).toContain("Jenis hook pembuka: problem_solution");
    expect(prompt).toContain("Karakter delivery voice: medium");
    expect(prompt).toContain("Subtitle akan dibuat dari naskah ini");
    expect(prompt).toContain("cek link produk di deskripsi untuk lihat detail lengkapnya");
  });

  it("uses stricter hook and CTA scoring guidance for clip analysis", () => {
    const prompt = buildClipSelectionPrompt({
      title: "Blender portable mini",
      description: "Blender ringkas untuk bikin jus cepat di rumah atau di kantor.",
      affiliateLink: "https://contoh.test/produk",
      candidates: [
        {
          clipId: "clip_1",
          startSec: 0,
          endSec: 24,
          durationSec: 24
        }
      ]
    });

    expect(prompt).toContain("Hook visual di 1-2 detik pertama harus langsung terasa");
    expect(prompt).toContain("3-5 detik terakhir masih punya payoff visual");
    expect(prompt).toContain("Skor 9-10 hanya untuk clip yang sangat kuat sejak awal");
    expect(prompt).toContain("Turunkan skor secara tegas");
  });
});
