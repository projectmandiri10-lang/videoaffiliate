import type { PlatformId, RenderProfileId, SubtitleStyle } from "./types.js";

export interface PlatformDefinition {
  label: string;
  renderProfileId: RenderProfileId;
  voiceStyle: string;
  tone: string;
  hook: string;
  srtStyle: SubtitleStyle;
  defaultVoiceName: string;
  defaultSpeechRate: number;
  ctaVariants: string[];
}

export const PLATFORM_ORDER: PlatformId[] = [
  "tiktok",
  "youtube",
  "facebook",
  "shopee"
];

export const PLATFORM_CONFIG: Record<PlatformId, PlatformDefinition> = {
  tiktok: {
    label: "TikTok",
    renderProfileId: "native_source",
    voiceStyle: "soft",
    tone: "relatable",
    hook: "curiosity",
    srtStyle: "short_punchy",
    defaultVoiceName: "Leda",
    defaultSpeechRate: 1,
    ctaVariants: [
      "cek keranjang kuningnya sekarang kalau mau lihat detailnya",
      "klik keranjang kuning buat cek harga dan variannya",
      "kalau cocok, langsung buka keranjang kuningnya",
      "lihat detail produknya dulu di keranjang kuning"
    ]
  },
  youtube: {
    label: "YouTube Shorts",
    renderProfileId: "youtube_editorial",
    voiceStyle: "medium",
    tone: "informative",
    hook: "problem_solution",
    srtStyle: "clear",
    defaultVoiceName: "Charon",
    defaultSpeechRate: 1,
    ctaVariants: [
      "cek link produk di deskripsi untuk lihat detail lengkapnya",
      "kalau mau lihat harga dan spesifikasinya, buka link di deskripsi",
      "langsung cek link di deskripsi atau komentar tersemat",
      "lihat produk lengkapnya lewat link yang ada di deskripsi"
    ]
  },
  facebook: {
    label: "Facebook",
    renderProfileId: "facebook_story",
    voiceStyle: "evergreen",
    tone: "storytelling",
    hook: "emotional",
    srtStyle: "narrative",
    defaultVoiceName: "Aoede",
    defaultSpeechRate: 1,
    ctaVariants: [
      "cek link produknya di komentar atau deskripsi",
      "kalau tertarik, buka tautannya di komentar",
      "lihat detail lengkapnya lewat link di komentar dan deskripsi",
      "langsung cek link di komentar buat lihat produknya"
    ]
  },
  shopee: {
    label: "Shopee",
    renderProfileId: "shopee_sales",
    voiceStyle: "hard",
    tone: "direct",
    hook: "cta",
    srtStyle: "sales",
    defaultVoiceName: "Kore",
    defaultSpeechRate: 1,
    ctaVariants: [
      "cek produknya langsung di keranjang atau etalase",
      "kalau mau beli, langsung buka halaman produknya di Shopee",
      "lihat harga dan variannya langsung di halaman produk",
      "langsung masuk ke produk Shopee ini kalau mau checkout"
    ]
  }
};

export const PLATFORM_LABELS: Record<PlatformId, string> = PLATFORM_ORDER.reduce(
  (accumulator, platformId) => {
    accumulator[platformId] = PLATFORM_CONFIG[platformId].label;
    return accumulator;
  },
  {} as Record<PlatformId, string>
);

export function createDefaultCtaSequence(): Record<PlatformId, number> {
  return PLATFORM_ORDER.reduce(
    (accumulator, platformId) => {
      accumulator[platformId] = 0;
      return accumulator;
    },
    {} as Record<PlatformId, number>
  );
}
