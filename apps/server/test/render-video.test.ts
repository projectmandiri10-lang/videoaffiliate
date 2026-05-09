import { describe, expect, it } from "vitest";
import { buildRenderGraph } from "../src/utils/render-video.js";

const videoMetadata = {
  durationSec: 18,
  width: 1080,
  height: 1920,
  rotation: 0,
  displayWidth: 1080,
  displayHeight: 1920
};

describe("render video graph", () => {
  it("keeps TikTok graph native without subtitle burn-in", () => {
    const graph = buildRenderGraph({
      subtitlePath: "outputs/tiktok/sample.srt",
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "native_source",
      renderVariantKey: "native_base",
      titleText: "Sabun Jerawat",
      ctaText: "cek keranjang kuning"
    });

    expect(graph.renderProfileId).toBe("native_source");
    expect(graph.burnSubtitles).toBe(false);
    expect(graph.filterComplex).not.toContain("subtitles=");
    expect(graph.filterComplex).not.toContain("drawbox=");
  });

  it("builds YouTube graph with subtitle burn-in and intro/outro overlays", () => {
    const graph = buildRenderGraph({
      subtitlePath: "outputs/youtube/sample.srt",
      subtitleCues: [
        {
          startSec: 0.2,
          endSec: 2.4,
          lines: ["Ini subtitle YouTube", "tampil di bawah video"]
        }
      ],
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "youtube_editorial",
      renderVariantKey: "editorial_center",
      titleText: "Sabun Jerawat",
      ctaText: "cek link produk di deskripsi"
    });

    expect(graph.renderProfileId).toBe("youtube_editorial");
    expect(graph.variantKey).toBe("editorial_center");
    expect(graph.burnSubtitles).toBe(true);
    expect(graph.filterComplex).not.toContain("subtitles=");
    expect(graph.filterComplex).toContain("drawtext=fontfile=");
    expect(graph.filterComplex).toContain("BarlowSemiCondensed-SemiBold.ttf");
    expect(graph.filterComplex).toContain("Ini subtitle YouTube");
    expect(graph.filterComplex).toContain("tampil di bawah video");
    expect(graph.filterComplex).toContain("y=h-");
    expect(graph.filterComplex).toContain("enable='between(t,0.200,2.400)'");
    expect(graph.filterComplex).toContain("SHORT REVIEW");
    expect(graph.filterComplex).toContain("drawbox=x=");
  });

  it("builds Facebook graph with subtitle burn-in and matching text font", () => {
    const graph = buildRenderGraph({
      subtitlePath: "outputs/facebook/sample.srt",
      subtitleCues: [
        {
          startSec: 0.4,
          endSec: 3.1,
          lines: ["Ini subtitle Facebook", "muncul di video"]
        }
      ],
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "facebook_story",
      renderVariantKey: "story_upper",
      titleText: "Sabun Jerawat",
      ctaText: "cek komentar atau deskripsi"
    });

    expect(graph.renderProfileId).toBe("facebook_story");
    expect(graph.variantKey).toBe("story_upper");
    expect(graph.burnSubtitles).toBe(true);
    expect(graph.filterComplex).not.toContain("subtitles=");
    expect(graph.filterComplex).toContain("drawtext=fontfile=");
    expect(graph.filterComplex).toContain("NunitoSans-Variable.ttf");
    expect(graph.filterComplex).toContain("Ini subtitle Facebook");
    expect(graph.filterComplex).toContain("muncul di video");
    expect(graph.filterComplex).toContain("y=h-");
    expect(graph.filterComplex).toContain("enable='between(t,0.400,3.100)'");
    expect(graph.filterComplex).toContain("CERITA PRODUK");
  });

  it("builds Shopee graph with subtitle burn-in and badge overlay", () => {
    const graph = buildRenderGraph({
      subtitlePath: "outputs/shopee/sample.srt",
      subtitleCues: [
        {
          startSec: 0.1,
          endSec: 2.7,
          lines: ["Ini subtitle Shopee", "jelas di bawah"]
        }
      ],
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "shopee_sales",
      renderVariantKey: "sales_right",
      titleText: "Sabun Jerawat",
      ctaText: "buka produk di Shopee sekarang"
    });

    expect(graph.renderProfileId).toBe("shopee_sales");
    expect(graph.variantKey).toBe("sales_right");
    expect(graph.filterComplex).not.toContain("subtitles=");
    expect(graph.filterComplex).toContain("drawtext=fontfile=");
    expect(graph.filterComplex).toContain("Archivo-Variable.ttf");
    expect(graph.filterComplex).toContain("Ini subtitle Shopee");
    expect(graph.filterComplex).toContain("jelas di bawah");
    expect(graph.filterComplex).toContain("y=h-");
    expect(graph.filterComplex).toContain("enable='between(t,0.100,2.700)'");
    expect(graph.filterComplex).toContain("PROMO PILIHAN");
    expect(graph.filterComplex).toContain("Cek produk");
  });

  it("adds stronger visual treatment when audit boost is enabled", () => {
    const normal = buildRenderGraph({
      subtitlePath: "outputs/youtube/sample.srt",
      subtitleCues: [
        {
          startSec: 0.2,
          endSec: 2.4,
          lines: ["Subtitle normal"]
        }
      ],
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "youtube_editorial",
      renderVariantKey: "editorial_center",
      titleText: "Sabun Jerawat",
      ctaText: "cek link produk di deskripsi"
    });
    const boosted = buildRenderGraph({
      subtitlePath: "outputs/youtube/sample.srt",
      subtitleCues: [
        {
          startSec: 0.2,
          endSec: 2.4,
          lines: ["Subtitle normal"]
        }
      ],
      targetDurationSec: 18,
      videoMetadata,
      renderProfileId: "youtube_editorial",
      renderVariantKey: "editorial_center",
      auditBoost: true,
      titleText: "Sabun Jerawat",
      ctaText: "cek link produk di deskripsi"
    });

    expect(boosted.filterComplex).not.toBe(normal.filterComplex);
    expect(boosted.filterComplex).toContain("drawbox=x=0:y=0:w=27:h=ih");
    expect(boosted.filterComplex).toContain("brightness=0.022");
    expect(boosted.filterComplex).toContain("contrast=1.085");
    expect(boosted.filterComplex).toContain("unsharp=5:5:0.73");
  });
});
