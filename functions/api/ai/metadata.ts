import type { GenerateSocialMetadataInput } from "@app/core";
import { generateMetadata } from "../../_lib/gemini";
import { errorResponse, json } from "../../_lib/response";

export async function onRequestPost(context: {
  request: Request;
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string };
}) {
  try {
    const body = (await context.request.json()) as GenerateSocialMetadataInput;
    const result = await generateMetadata(context.env, body);
    return json(result);
  } catch (error) {
    return errorResponse("Gagal membuat caption dan hashtags lewat Gemini proxy.", 500, error);
  }
}
