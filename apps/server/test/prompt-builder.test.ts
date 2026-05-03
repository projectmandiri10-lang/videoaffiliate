import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { buildScriptPrompt } from "../src/services/prompt-builder.js";

describe("prompt builder", () => {
  it("injects platform-specific prompt instructions", () => {
    const prompt = buildScriptPrompt({
      settings: DEFAULT_SETTINGS,
      platformId: "tiktok",
      title: "Serum pencerah wajah",
      description: "Serum dengan niacinamide untuk bantu mencerahkan kulit kusam.",
      videoDurationSec: 20,
      ctaText: "cek keranjang kuningnya sekarang kalau mau lihat detailnya"
    });

    expect(prompt).toContain("Kalimat pembuka wajib menjadi hook kuat");
    expect(prompt).toContain("Platform target: TikTok");
    expect(prompt).toContain("Jenis hook pembuka: curiosity");
    expect(prompt).toContain("Karakter delivery voice: soft");
    expect(prompt).toContain("CTA wajib sesuai kebiasaan platform target");
    expect(prompt).toContain('cek keranjang kuningnya sekarang kalau mau lihat detailnya');
  });
});
