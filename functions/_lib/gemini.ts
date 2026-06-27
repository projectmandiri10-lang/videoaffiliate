import OpenAI from "openai";
import {
  DEFAULT_GEMINI_TTS_MODEL,
  buildClipSelectionPrompt,
  buildReelsMetadataPrompt,
  extractAudioFromResponse,
  extractClipCandidateScores,
  extractScriptText,
  extractSocialMetadata,
  normalizeGeminiTtsModel,
  toLiteLlmGeminiModel
} from "@app/core";
import type {
  AnalyzeClipCandidatesInput,
  GenerateSocialMetadataInput
} from "@app/core";

interface LiteLlmEnv {
  LITELLM_API_KEY?: string;
  LITELLM_BASE_URL?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
}

function requireBaseUrl(env: LiteLlmEnv): string {
  const baseUrl = env.LITELLM_BASE_URL?.trim() || env.OPENAI_BASE_URL?.trim() || "";
  if (!baseUrl) {
    throw new Error("LITELLM_BASE_URL belum dikonfigurasi di Cloudflare Pages Functions.");
  }

  let parsed: URL;
  try {
    parsed = new URL(baseUrl.replace(/\/+$/, ""));
  } catch {
    throw new Error(
      "LITELLM_BASE_URL tidak valid. Contoh: http://127.0.0.1:4000 atau https://litellm.example.com"
    );
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/v1";
  } else if (!parsed.pathname.endsWith("/v1")) {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1`;
  }

  return parsed.toString().replace(/\/$/, "");
}

function resolveApiKey(env: LiteLlmEnv): string {
  return env.LITELLM_API_KEY?.trim() || env.OPENAI_API_KEY?.trim() || "litellm-no-auth";
}

function createClient(env: LiteLlmEnv) {
  return new OpenAI({
    apiKey: resolveApiKey(env),
    baseURL: requireBaseUrl(env)
  });
}

function buildFrameContent(prompt: string, frames: Array<{ dataUrl: string; timestampSec: number }>) {
  return [
    { type: "text", text: prompt },
    ...frames.flatMap((frame, index) => [
      {
        type: "text",
        text: `Frame ${index + 1} pada ${frame.timestampSec.toFixed(2)} detik.`
      },
      {
        type: "image_url",
        image_url: {
          url: frame.dataUrl
        }
      }
    ])
  ];
}

export async function generateScript(env: LiteLlmEnv, input: {
  model: string;
  prompt: string;
  frames: Array<{ dataUrl: string; timestampSec: number }>;
}): Promise<string> {
  const client = createClient(env);
  const response = await client.chat.completions.create({
    model: toLiteLlmGeminiModel(input.model),
    messages: [
      {
        role: "user",
        content: buildFrameContent(input.prompt, input.frames)
      }
    ]
  } as any);
  return extractScriptText(response);
}

export async function analyzeCandidates(env: LiteLlmEnv, input: AnalyzeClipCandidatesInput) {
  const client = createClient(env);
  const prompt = buildClipSelectionPrompt({
    title: input.title,
    description: input.description,
    affiliateLink: input.affiliateLink,
    candidates: input.candidates.map((candidate) => ({
      clipId: candidate.clipId,
      startSec: candidate.startSec,
      endSec: candidate.endSec,
      durationSec: candidate.durationSec
    }))
  });

  const contents = [
    { type: "text", text: prompt },
    ...input.candidates.flatMap((candidate) => [
      {
        type: "text",
        text: `Kandidat ${candidate.clipId} pada ${candidate.startSec.toFixed(2)}-${candidate.endSec.toFixed(2)} detik.`
      },
      ...candidate.frames.flatMap((frame, index) => {
        return [
          {
            type: "text",
            text: `Frame ${index + 1} kandidat ${candidate.clipId} pada ${frame.timestampSec.toFixed(2)} detik.`
          },
          {
            type: "image_url",
            image_url: {
              url: frame.dataUrl
            }
          }
        ];
      })
    ])
  ];

  const response = await client.chat.completions.create({
    model: toLiteLlmGeminiModel(input.model),
    messages: [
      {
        role: "user",
        content: contents
      }
    ],
    response_format: {
      type: "json_object"
    }
  } as any);
  const parsed = extractClipCandidateScores(response);
  const byClipId = new Map(parsed.map((item) => [item.clipId, item]));
  return input.candidates.map((candidate) => ({
    clipId: candidate.clipId,
    startSec: candidate.startSec,
    endSec: candidate.endSec,
    durationSec: candidate.durationSec,
    frameTimestamps: candidate.frameTimestamps,
    previewPath: undefined,
    score: byClipId.get(candidate.clipId)?.score ?? 0,
    reason:
      byClipId.get(candidate.clipId)?.reason ||
      "Potongan ini cukup kuat untuk dijadikan kandidat YouTube Shorts."
  }));
}

export async function generateMetadata(env: LiteLlmEnv, input: GenerateSocialMetadataInput) {
  const client = createClient(env);
  const response = await client.chat.completions.create({
    model: toLiteLlmGeminiModel(input.model),
    messages: [
      {
        role: "user",
        content: buildReelsMetadataPrompt({
          title: input.title,
          description: input.description,
          platformId: input.platformId,
          scriptText: input.scriptText,
          ctaText: input.ctaText
        })
      }
    ],
    response_format: {
      type: "json_object"
    }
  } as any);
  return extractSocialMetadata(response);
}

export async function generateTts(env: LiteLlmEnv, input: {
  model: string;
  text: string;
  voiceName: string;
  speechRate: number;
}) {
  const client = createClient(env);
  const resolvedModel = normalizeGeminiTtsModel(input.model) || DEFAULT_GEMINI_TTS_MODEL;
  const transcript =
    input.speechRate >= 1.1 ? `[very fast] ${input.text}` : input.speechRate <= 0.9 ? `[very slow] ${input.text}` : input.text;
  const response = await client.chat.completions.create({
    model: toLiteLlmGeminiModel(resolvedModel),
    messages: [
      {
        role: "user",
        content: transcript
      }
    ],
    modalities: ["text", "audio"],
    audio: {
      voice: input.voiceName,
      format: "wav"
    },
    extra_body: {
      allowed_openai_params: ["audio", "modalities"]
    }
  } as any);
  return extractAudioFromResponse(response);
}
