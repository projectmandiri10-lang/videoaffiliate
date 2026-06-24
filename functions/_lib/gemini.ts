import { GoogleGenAI, createPartFromBase64, createPartFromText } from "@google/genai";
import {
  DEFAULT_GEMINI_TTS_MODEL,
  buildClipSelectionPrompt,
  buildReelsMetadataPrompt,
  extractAudioFromResponse,
  extractClipCandidateScores,
  extractScriptText,
  extractSocialMetadata,
  normalizeGeminiTtsModel,
  parseDataUrl
} from "@app/core";
import type {
  AnalyzeClipCandidatesInput,
  GenerateSocialMetadataInput
} from "@app/core";

function requireApiKey(env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string }): string {
  const apiKey = env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim() || "";
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY belum dikonfigurasi di Cloudflare Pages Functions.");
  }
  return apiKey;
}

function createClient(env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string }) {
  return new GoogleGenAI({ apiKey: requireApiKey(env) });
}

export async function generateScript(env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string }, input: {
  model: string;
  prompt: string;
  frames: Array<{ dataUrl: string; timestampSec: number }>;
}): Promise<string> {
  const client = createClient(env);
  const contents = [
    createPartFromText(input.prompt),
    ...input.frames.flatMap((frame, index) => {
      const parsed = parseDataUrl(frame.dataUrl);
      return [
        createPartFromText(`Frame ${index + 1} pada ${frame.timestampSec.toFixed(2)} detik.`),
        createPartFromBase64(parsed.base64, parsed.mimeType)
      ];
    })
  ];
  const response = await client.models.generateContent({
    model: input.model,
    contents
  });
  return extractScriptText(response);
}

export async function analyzeCandidates(
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string },
  input: AnalyzeClipCandidatesInput
) {
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
    createPartFromText(prompt),
    ...input.candidates.flatMap((candidate) => [
      createPartFromText(
        `Kandidat ${candidate.clipId} pada ${candidate.startSec.toFixed(2)}-${candidate.endSec.toFixed(2)} detik.`
      ),
      ...candidate.frames.flatMap((frame, index) => {
        const parsed = parseDataUrl(frame.dataUrl);
        return [
          createPartFromText(
            `Frame ${index + 1} kandidat ${candidate.clipId} pada ${frame.timestampSec.toFixed(2)} detik.`
          ),
          createPartFromBase64(parsed.base64, parsed.mimeType)
        ];
      })
    ])
  ];

  const response = await client.models.generateContent({
    model: input.model,
    contents,
    config: {
      responseMimeType: "application/json"
    }
  });
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

export async function generateMetadata(
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string },
  input: GenerateSocialMetadataInput
) {
  const client = createClient(env);
  const response = await client.models.generateContent({
    model: input.model,
    contents: [
      createPartFromText(
        buildReelsMetadataPrompt({
          title: input.title,
          description: input.description,
          platformId: input.platformId,
          scriptText: input.scriptText,
          ctaText: input.ctaText
        })
      )
    ],
    config: {
      responseMimeType: "application/json"
    }
  });
  return extractSocialMetadata(response);
}

export async function generateTts(
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string },
  input: {
    model: string;
    text: string;
    voiceName: string;
    speechRate: number;
  }
) {
  const client = createClient(env);
  const resolvedModel = normalizeGeminiTtsModel(input.model) || DEFAULT_GEMINI_TTS_MODEL;
  const transcript =
    input.speechRate >= 1.1 ? `[very fast] ${input.text}` : input.speechRate <= 0.9 ? `[very slow] ${input.text}` : input.text;
  const response = await client.models.generateContent({
    model: resolvedModel,
    contents: transcript,
    config: {
      responseModalities: ["AUDIO"],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: {
            voiceName: input.voiceName
          }
        }
      }
    }
  });
  return extractAudioFromResponse(response);
}
