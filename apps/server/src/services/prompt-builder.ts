import { buildPlatformCtaInstruction } from "../utils/cta.js";
import type { AppSettings, PlatformId } from "../types.js";
import { PLATFORM_CONFIG, PLATFORM_LABELS } from "../platform-config.js";

export interface PromptInput {
  settings: AppSettings;
  platformId: PlatformId;
  title: string;
  description: string;
  videoDurationSec: number;
  ctaText: string;
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
  const platform = PLATFORM_CONFIG.youtube;
  const ctaInstruction = "CTA harus muncul natural di bagian akhir dan mengarah ke deskripsi atau komentar tersemat.";

  return [
    "Anda adalah copywriter affiliate YouTube Shorts berbahasa Indonesia.",
    "Tugas: buat naskah voice-over yang persuasif, aman, natural, dan terasa seperti review cepat yang retention-friendly.",
    "Aturan penting:",
    "- Gunakan Bahasa Indonesia, gaya percakapan.",
    "- Kalimat pertama wajib menjadi hook kuat agar penonton berhenti scroll dalam 1-2 detik.",
    "- Fokus ke masalah, momen demo produk, lalu solusi/manfaat yang terlihat di video.",
    "- Hindari klaim absolut, medis, atau menyesatkan.",
    "- Hindari filler yang terlalu panjang atau intro yang lambat.",
    "- Subtitle akan dibuat dari naskah ini, jadi kalimat harus singkat dan mudah dibaca.",
    `- Panjang naskah harus sekitar ${words.target} kata (rentang ${words.min}-${words.max} kata) agar pas untuk durasi video ${input.videoDurationSec.toFixed(2)} detik.`,
    `- ${ctaInstruction}`,
    "- CTA wajib sesuai kebiasaan YouTube Shorts affiliate, tidak generik untuk semua platform.",
    buildPlatformCtaInstruction(input.settings.ctaMode, input.ctaText),
    "",
    `Platform target: ${PLATFORM_LABELS.youtube}`,
    `Tone utama: ${platform.tone}`,
    `Jenis hook pembuka: ${platform.hook}`,
    `Karakter delivery voice: ${platform.voiceStyle}`,
    `Judul produk: ${input.title}`,
    `Deskripsi produk: ${input.description}`,
    "",
    "Bangun naskah final sesuai arahan di atas dan kembalikan teks naskah saja, tanpa penjelasan tambahan."
  ].join("\n");
}

export interface ReelsMetadataPromptInput {
  title: string;
  description: string;
  platformId: PlatformId;
  scriptText: string;
  ctaText: string;
}

export function buildReelsMetadataPrompt(input: ReelsMetadataPromptInput): string {
  return [
    "Anda adalah social media copywriter untuk YouTube Shorts affiliate.",
    "Buat caption dan hashtags berdasarkan konten berikut.",
    "Aturan:",
    "- Bahasa Indonesia.",
    "- Caption maksimal 220 karakter, 1-2 kalimat, soft CTA di akhir.",
    '- CTA akhir caption harus mengikuti pola yang dekat dengan: "' + input.ctaText + '".',
    "- Jangan klaim berlebihan atau absolut.",
    "- Hashtags 4 sampai 8, relevan produk dan YouTube Shorts, semuanya diawali #.",
    "- Kembalikan HANYA JSON valid tanpa markdown.",
    '- Format tepat: {"caption":"...","hashtags":["#a","#b"]}',
    "",
    `Platform: ${PLATFORM_LABELS.youtube}`,
    `Judul: ${input.title}`,
    `Deskripsi: ${input.description}`,
    `Naskah voice-over: ${input.scriptText}`
  ].join("\n");
}

export interface ClipSelectionPromptInput {
  title: string;
  description: string;
  affiliateLink: string;
  candidates: Array<{
    clipId: string;
    startSec: number;
    endSec: number;
    durationSec: number;
  }>;
}

export function buildClipSelectionPrompt(input: ClipSelectionPromptInput): string {
  const candidatesBlock = input.candidates
    .map(
      (candidate) =>
        `- ${candidate.clipId}: ${candidate.startSec.toFixed(2)}s sampai ${candidate.endSec.toFixed(2)}s (${candidate.durationSec.toFixed(2)} detik)`
    )
    .join("\n");

  return [
    "Anda adalah editor YouTube Shorts affiliate yang menilai potongan video produk.",
    "Tugas: beri skor untuk setiap kandidat clip berdasarkan peluang performa untuk YouTube Shorts.",
    "Kriteria penilaian:",
    "- Hook visual di 1-2 detik pertama harus langsung terasa, bukan setup lambat.",
    "- Produk harus terlihat jelas secepat mungkin dan tetap dominan di sebagian besar clip.",
    "- Ada demo, transformasi, atau aktivitas yang mudah dipahami cepat tanpa penjelasan panjang.",
    "- 3-5 detik terakhir masih punya payoff visual agar CTA affiliate bisa masuk natural.",
    "- Cocok untuk voice over affiliate yang aman, natural, dan problem-solution.",
    "- Potensi retention tinggi dari awal sampai CTA akhir.",
    "Aturan scoring keras:",
    "- Skor 9-10 hanya untuk clip yang sangat kuat sejak awal, produknya jelas, dan ending-nya enak untuk CTA.",
    "- Skor 7-8 untuk clip yang bagus tetapi hook awal atau ending CTA belum maksimal.",
    "- Skor 6 ke bawah untuk clip yang lambat, membingungkan, produk telat terlihat, atau payoff visualnya lemah.",
    "- Turunkan skor secara tegas jika 1-2 detik pertama lemah, produk baru jelas setelah beberapa detik, atau bagian akhir terasa tanggung.",
    "Aturan output:",
    "- Skor 0 sampai 10.",
    "- Reason maksimal 1 kalimat singkat dan spesifik.",
    "- Kembalikan HANYA JSON valid.",
    '- Format tepat: {"candidates":[{"clipId":"clip_1","score":8.7,"reason":"..."},{"clipId":"clip_2","score":6.9,"reason":"..."}]}',
    "",
    `Judul produk: ${input.title}`,
    `Deskripsi produk: ${input.description}`,
    `Affiliate link: ${input.affiliateLink}`,
    "Daftar kandidat clip:",
    candidatesBlock,
    "",
    "Gunakan frame-frame yang saya kirim untuk menilai tiap kandidat clip."
  ].join("\n");
}
