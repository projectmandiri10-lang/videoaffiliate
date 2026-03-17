import type {
  AppSettings,
  ExcitedVoicePreset,
  StyleId,
  TtsVoiceOption
} from "./types.js";

export const MAX_HISTORY = 20;
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;
export const DEFAULT_PORT = 8787;

const STYLE_PROMPTS: Record<StyleId, string> = {
  evergreen:
    "Buat naskah voice-over gaya evergreen untuk video affiliate. Tekankan manfaat jangka panjang produk, bahasa natural, tidak berlebihan, CTA di akhir (arahkan ke komentar dan deskripsi).",
  soft_selling:
    "Buat naskah voice-over gaya soft selling. Bangun empati, jelaskan problem pengguna, tawarkan produk sebagai solusi halus, CTA di akhir (arahkan ke komentar dan deskripsi).",
  hard_selling:
    "Buat naskah voice-over gaya hard selling dengan urgency wajar. Fokus value, promo, alasan beli sekarang, tetap aman tanpa klaim absolut, CTA di akhir (arahkan ke komentar dan deskripsi).",
  problem_solution:
    "Buat naskah voice-over edukasi problem-solution. Awali pain point, jelaskan penyebab singkat, masukkan solusi produk secara praktis, CTA di akhir (arahkan ke komentar dan deskripsi)."
};

const STYLE_VOICES: Record<StyleId, string> = {
  evergreen: "Aoede",
  soft_selling: "Leda",
  hard_selling: "Kore",
  problem_solution: "Puck"
};

export const STYLE_ORDER: StyleId[] = [
  "evergreen",
  "soft_selling",
  "hard_selling",
  "problem_solution"
];

export const DEFAULT_SETTINGS: AppSettings = {
  scriptModel: "gemini-3-flash-preview",
  ttsModel: "gemini-2.5-flash-preview-tts",
  language: "id-ID",
  maxVideoSeconds: 60,
  safetyMode: "safe_marketing",
  ctaPosition: "end",
  concurrency: 1,
  styles: STYLE_ORDER.map((styleId) => ({
    styleId,
    enabled: true,
    promptTemplate: STYLE_PROMPTS[styleId],
    voiceName: STYLE_VOICES[styleId],
    speechRate: 1
  }))
};

export const STYLE_LABELS: Record<StyleId, string> = {
  evergreen: "Evergreen",
  soft_selling: "Soft Selling",
  hard_selling: "Hard Selling",
  problem_solution: "Edukasi Problem-Solution"
};

export const GEMINI_TTS_VOICES: TtsVoiceOption[] = [
  { voiceName: "Zephyr", label: "Zephyr", tone: "Bright", gender: "neutral" },
  { voiceName: "Puck", label: "Puck", tone: "Upbeat", gender: "male" },
  { voiceName: "Charon", label: "Charon", tone: "Informative", gender: "male" },
  { voiceName: "Kore", label: "Kore", tone: "Firm", gender: "female" },
  { voiceName: "Fenrir", label: "Fenrir", tone: "Excitable", gender: "male" },
  { voiceName: "Leda", label: "Leda", tone: "Youthful", gender: "female" },
  { voiceName: "Orus", label: "Orus", tone: "Firm", gender: "male" },
  { voiceName: "Aoede", label: "Aoede", tone: "Breezy", gender: "female" },
  {
    voiceName: "Callirrhoe",
    label: "Callirrhoe",
    tone: "Easy-going",
    gender: "female"
  },
  { voiceName: "Autonoe", label: "Autonoe", tone: "Bright", gender: "female" },
  { voiceName: "Enceladus", label: "Enceladus", tone: "Breathy", gender: "neutral" },
  { voiceName: "Iapetus", label: "Iapetus", tone: "Clear", gender: "male" },
  { voiceName: "Umbriel", label: "Umbriel", tone: "Easy-going", gender: "neutral" },
  { voiceName: "Algieba", label: "Algieba", tone: "Smooth", gender: "neutral" },
  { voiceName: "Despina", label: "Despina", tone: "Smooth", gender: "female" },
  { voiceName: "Erinome", label: "Erinome", tone: "Clear", gender: "female" },
  { voiceName: "Algenib", label: "Algenib", tone: "Gravelly", gender: "male" },
  {
    voiceName: "Rasalgethi",
    label: "Rasalgethi",
    tone: "Informative",
    gender: "male"
  },
  { voiceName: "Laomedeia", label: "Laomedeia", tone: "Upbeat", gender: "female" },
  { voiceName: "Achernar", label: "Achernar", tone: "Soft", gender: "female" },
  { voiceName: "Alnilam", label: "Alnilam", tone: "Firm", gender: "male" },
  { voiceName: "Schedar", label: "Schedar", tone: "Even", gender: "male" },
  { voiceName: "Gacrux", label: "Gacrux", tone: "Mature", gender: "male" },
  {
    voiceName: "Pulcherrima",
    label: "Pulcherrima",
    tone: "Forward",
    gender: "female"
  },
  { voiceName: "Achird", label: "Achird", tone: "Friendly", gender: "neutral" },
  {
    voiceName: "Zubenelgenubi",
    label: "Zubenelgenubi",
    tone: "Casual",
    gender: "neutral"
  },
  {
    voiceName: "Vindemiatrix",
    label: "Vindemiatrix",
    tone: "Gentle",
    gender: "female"
  },
  { voiceName: "Sadachbia", label: "Sadachbia", tone: "Lively", gender: "female" },
  {
    voiceName: "Sadaltager",
    label: "Sadaltager",
    tone: "Knowledgeable",
    gender: "male"
  },
  { voiceName: "Sulafat", label: "Sulafat", tone: "Warm", gender: "female" }
];

export const GEMINI_EXCITED_PRESETS: ExcitedVoicePreset[] = [
  {
    presetId: "female_excited_v1",
    label: "Excited Wanita V1",
    version: "v1",
    gender: "female",
    voiceName: "Leda"
  },
  {
    presetId: "female_excited_v2",
    label: "Excited Wanita V2",
    version: "v2",
    gender: "female",
    voiceName: "Autonoe"
  },
  {
    presetId: "female_excited_v3",
    label: "Excited Wanita V3",
    version: "v3",
    gender: "female",
    voiceName: "Sadachbia"
  },
  {
    presetId: "male_excited_v1",
    label: "Excited Pria V1",
    version: "v1",
    gender: "male",
    voiceName: "Fenrir"
  },
  {
    presetId: "male_excited_v2",
    label: "Excited Pria V2",
    version: "v2",
    gender: "male",
    voiceName: "Puck"
  },
  {
    presetId: "male_excited_v3",
    label: "Excited Pria V3",
    version: "v3",
    gender: "male",
    voiceName: "Orus"
  }
];

export function findTtsVoiceByName(voiceName: string): TtsVoiceOption | undefined {
  return GEMINI_TTS_VOICES.find((voice) => voice.voiceName === voiceName);
}

export function isKnownTtsVoiceName(voiceName: string): boolean {
  return Boolean(findTtsVoiceByName(voiceName));
}
