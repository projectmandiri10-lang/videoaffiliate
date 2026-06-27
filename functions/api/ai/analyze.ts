import type { AnalyzeClipCandidatesInput } from "@app/core";
import { analyzeCandidates } from "../../_lib/gemini";
import { errorResponse, json } from "../../_lib/response";

export async function onRequestPost(context: {
  request: Request;
  env: {
    LITELLM_API_KEY?: string;
    LITELLM_BASE_URL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_BASE_URL?: string;
  };
}) {
  try {
    const body = (await context.request.json()) as AnalyzeClipCandidatesInput;
    const result = await analyzeCandidates(context.env, body);
    return json(result);
  } catch (error) {
    return errorResponse("Gagal menganalisis kandidat clip lewat LiteLLM Gemini proxy.", 500, error);
  }
}
