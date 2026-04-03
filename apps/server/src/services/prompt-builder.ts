import type { AppSettings, PlatformId } from "../types.js";
import { PLATFORM_CONFIG, PLATFORM_LABELS } from "../platform-config.js";

export interface PromptInput {
  settings: AppSettings;
  platformId: PlatformId;
  title: string;
  description: string;
  videoDurationSec: number;
}

function estimateWordRange(durationSec: number): { min: number; target: number; max: number } {
  const safeDuration = Math.max(5, durationSec);
  const target = Math.round(safeDuration * 2.2);
  const min = Math.max(20, Math.round(target * 0.85));
  const max = Math.max(min + 8, Math.round(target * 1.15));
  return { min, target, max };
}

export function buildScriptPrompt(input: PromptInput): string {
  const words = estimateWordRange(input.videoDurationSec);
  const platform = PLATFORM_CONFIG[input.platformId];
  const ctaInstruction =
    input.settings.ctaPosition === "end"
      ? "CTA harus ditempatkan di akhir naskah."
      : "CTA harus natural dan tidak memotong alur.";

  return [
    "Anda adalah copywriter affiliate video pendek berbahasa Indonesia.",
    "Tugas: buat naskah voice-over yang persuasif, aman, natural, dan sesuai karakter platform.",
    "Aturan penting:",
    "- Gunakan Bahasa Indonesia, gaya percakapan.",
    "- Kalimat pembuka wajib menjadi hook kuat agar penonton berhenti scroll.",
    "- Hindari klaim absolut, medis, atau menyesatkan.",
    "- Fokus pada manfaat produk, konteks video, dan alasan orang tertarik untuk klik.",
    `- Panjang naskah harus sekitar ${words.target} kata (rentang ${words.min}-${words.max} kata) agar pas untuk durasi video ${input.videoDurationSec.toFixed(2)} detik.`,
    `- ${ctaInstruction}`,
    '- CTA wajib mengarahkan penonton untuk cek keranjang produk.',
    '- Gunakan CTA yang jelas dan natural seperti "cek keranjang" atau "ambil lewat keranjang".',
    "",
    `Platform target: ${PLATFORM_LABELS[input.platformId]}`,
    `Tone utama: ${platform.tone}`,
    `Jenis hook pembuka: ${platform.hook}`,
    `Karakter delivery voice: ${platform.voiceStyle}`,
    `Judul produk: ${input.title}`,
    `Deskripsi produk: ${input.description}`,
    "",
    "Bangun naskah final sesuai arahan platform di atas dan kembalikan teks naskah saja, tanpa penjelasan tambahan."
  ].join("\n");
}

export interface ReelsMetadataPromptInput {
  title: string;
  description: string;
  platformId: PlatformId;
  scriptText: string;
}

export function buildReelsMetadataPrompt(input: ReelsMetadataPromptInput): string {
  return [
    "Anda adalah social media copywriter untuk video affiliate pendek.",
    "Buat caption dan hashtags berdasarkan konten berikut.",
    "Aturan:",
    "- Bahasa Indonesia.",
    "- Caption maksimal 220 karakter, 1-2 kalimat, soft CTA di akhir.",
    "- CTA harus mengarahkan penonton untuk cek keranjang produk.",
    "- Jangan klaim berlebihan atau absolut.",
    "- Hashtags 6 sampai 10, relevan produk, semuanya diawali #.",
    "- Kembalikan HANYA JSON valid tanpa markdown.",
    '- Format tepat: {"caption":"...","hashtags":["#a","#b"]}',
    "",
    `Platform: ${PLATFORM_LABELS[input.platformId]}`,
    `Judul: ${input.title}`,
    `Deskripsi: ${input.description}`,
    `Naskah voice-over: ${input.scriptText}`
  ].join("\n");
}
