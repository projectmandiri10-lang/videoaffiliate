import type { CtaMode, PlatformId } from "./types.js";
import { PLATFORM_CONFIG } from "./platform-config.js";

export interface SelectedCta {
  index: number;
  text: string;
}

export function pickRandomCta(platformId: PlatformId): SelectedCta {
  const variants = PLATFORM_CONFIG[platformId].ctaVariants;
  if (!variants.length) {
    throw new Error(`CTA untuk platform ${platformId} belum dikonfigurasi.`);
  }
  const index = Math.floor(Math.random() * variants.length);
  return {
    index,
    text: variants[index] || variants[0] || ""
  };
}

export function pickSequentialCta(platformId: PlatformId, nextIndex: number): SelectedCta {
  const variants = PLATFORM_CONFIG[platformId].ctaVariants;
  if (!variants.length) {
    throw new Error(`CTA untuk platform ${platformId} belum dikonfigurasi.`);
  }
  const normalizedIndex = ((nextIndex % variants.length) + variants.length) % variants.length;
  return {
    index: normalizedIndex,
    text: variants[normalizedIndex] || variants[0] || ""
  };
}

export function getNextSequentialCtaIndex(platformId: PlatformId, currentIndex: number): number {
  const variants = PLATFORM_CONFIG[platformId].ctaVariants;
  if (!variants.length) {
    return 0;
  }
  const normalizedIndex = ((currentIndex % variants.length) + variants.length) % variants.length;
  return (normalizedIndex + 1) % variants.length;
}

export function buildPlatformCtaInstruction(mode: CtaMode, ctaText: string): string {
  const modeLabel = mode === "sequential" ? "berurutan" : "acak";
  return `- CTA penutup dipilih secara ${modeLabel} untuk platform ini dan harus sangat dekat dengan pola berikut: "${ctaText}".`;
}
