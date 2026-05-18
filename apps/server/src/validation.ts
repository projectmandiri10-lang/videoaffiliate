import { z } from "zod";
import { isKnownTtsVoiceName, PLATFORM_ORDER } from "./constants.js";
import type { AppSettings, PlatformId } from "./types.js";
import { createDefaultCtaSequence } from "./platform-config.js";

const platformIdSchema = z.enum(PLATFORM_ORDER);
const nonEmptyTextSchema = z.string().trim().min(1);
const speechRateSchema = z.number().min(0.7).max(1.3);
const ctaModeSchema = z.enum(["random", "sequential"]);

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

const ctaSequenceSchema = z.object({
  tiktok: z.number().int().min(0).default(0),
  youtube: z.number().int().min(0).default(0),
  facebook: z.number().int().min(0).default(0),
  shopee: z.number().int().min(0).default(0)
});

const createJobPlatformIdsSchema = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
  }
}, z.array(platformIdSchema).min(1, "Pilih minimal satu platform.")).transform((platformIds) => {
  const unique = new Set(platformIds);
  return PLATFORM_ORDER.filter((platformId) => unique.has(platformId));
});

export const settingsSchema = z.object({
  scriptModel: z.string().trim().min(1),
  ttsModel: z.string().trim().min(1),
  language: z.literal("id-ID"),
  maxVideoSeconds: z.number().int().min(10).max(180),
  safetyMode: z.literal("safe_marketing"),
  ctaPosition: z.literal("end"),
  ctaMode: ctaModeSchema.default("random"),
  ctaSequence: ctaSequenceSchema.default(createDefaultCtaSequence()),
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

const platformMetadataSchema = z.object({
  title: nonEmptyTextSchema,
  description: nonEmptyTextSchema,
  affiliateLink: nonEmptyTextSchema,
  captionText: nonEmptyTextSchema,
  hashtags: z.union([z.array(z.string()), z.string()]).optional().default([])
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

export function parseSelectedPlatformIds(input: unknown): PlatformId[] {
  return createJobPlatformIdsSchema.parse(input);
}

export function parseJobUpdateInput(input: unknown): {
  title: string;
  description: string;
  affiliateLink: string;
} {
  return jobUpdateSchema.parse(input);
}

export function parsePlatformMetadataInput(input: unknown): {
  title: string;
  description: string;
  affiliateLink: string;
  captionText: string;
  hashtags: string[];
} {
  const parsed = platformMetadataSchema.parse(input);
  return {
    title: parsed.title,
    description: parsed.description,
    affiliateLink: parsed.affiliateLink,
    captionText: parsed.captionText,
    hashtags: Array.isArray(parsed.hashtags)
      ? parsed.hashtags
      : parsed.hashtags
          .split(/[\s,]+/)
          .map((item) => item.trim())
          .filter(Boolean)
  };
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
