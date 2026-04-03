import { z } from "zod";
import { isKnownTtsVoiceName, PLATFORM_ORDER } from "./constants.js";
import type { AppSettings, PlatformId } from "./types.js";

const platformIdSchema = z.enum(PLATFORM_ORDER);
const nonEmptyTextSchema = z.string().trim().min(1);
const speechRateSchema = z.number().min(0.7).max(1.3);

const platformSchema = z.object({
  platformId: platformIdSchema,
  enabled: z.boolean(),
  voiceName: z
    .string()
    .trim()
    .min(1)
    .refine((value) => isKnownTtsVoiceName(value), "Voice tidak tersedia pada katalog Gemini."),
  speechRate: speechRateSchema
});

export const settingsSchema = z.object({
  scriptModel: z.string().trim().min(1),
  ttsModel: z.string().trim().min(1),
  language: z.literal("id-ID"),
  maxVideoSeconds: z.number().int().min(10).max(180),
  safetyMode: z.literal("safe_marketing"),
  ctaPosition: z.literal("end"),
  concurrency: z.literal(1),
  platforms: z
    .array(platformSchema)
    .length(PLATFORM_ORDER.length)
    .refine((platforms) => {
      const ids = platforms.map((platform) => platform.platformId);
      return PLATFORM_ORDER.every((id) => ids.includes(id));
    }, "Semua platform harus ada.")
});

export const retrySchema = z.object({
  platformId: platformIdSchema
});

const jobUpdateSchema = z.object({
  title: nonEmptyTextSchema,
  description: nonEmptyTextSchema,
  affiliateLink: nonEmptyTextSchema
});

const ttsPreviewSchema = z.object({
  voiceName: z
    .string()
    .trim()
    .min(1)
    .refine((value) => isKnownTtsVoiceName(value), "Voice tidak tersedia pada katalog Gemini."),
  speechRate: speechRateSchema.optional(),
  text: z.string().trim().min(1).max(220).optional()
});

export function parseSettings(input: unknown): AppSettings {
  const result = settingsSchema.parse(input);
  const sorted = [...result.platforms].sort(
    (a, b) => PLATFORM_ORDER.indexOf(a.platformId) - PLATFORM_ORDER.indexOf(b.platformId)
  );
  return {
    ...result,
    platforms: sorted
  };
}

export function parseRetryPlatformId(input: unknown): PlatformId {
  const parsed = retrySchema.parse(input);
  return parsed.platformId;
}

export function parseJobUpdateInput(input: unknown): {
  title: string;
  description: string;
  affiliateLink: string;
} {
  return jobUpdateSchema.parse(input);
}

export function parseSpeechRate(input: unknown): number {
  const numeric = typeof input === "number" ? input : Number(input);
  return speechRateSchema.parse(numeric);
}

export function parseTtsPreviewInput(input: unknown): {
  voiceName: string;
  speechRate: number;
  text?: string;
} {
  const parsed = ttsPreviewSchema.parse(input);
  return {
    voiceName: parsed.voiceName,
    speechRate: parsed.speechRate ?? 1,
    text: parsed.text
  };
}
