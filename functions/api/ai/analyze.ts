import type { AnalyzeClipCandidatesInput } from "@app/core";
import { analyzeCandidates } from "../../_lib/gemini";
import { errorResponse, json } from "../../_lib/response";

export async function onRequestPost(context: {
  request: Request;
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string };
}) {
  try {
    const body = (await context.request.json()) as AnalyzeClipCandidatesInput;
    const result = await analyzeCandidates(context.env, body);
    return json(result);
  } catch (error) {
    return errorResponse("Gagal menganalisis kandidat clip lewat Gemini proxy.", 500, error);
  }
}
