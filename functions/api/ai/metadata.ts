import type { GenerateSocialMetadataInput } from "@app/core";
import { generateMetadata } from "../../_lib/gemini";
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
    const body = (await context.request.json()) as GenerateSocialMetadataInput;
    const result = await generateMetadata(context.env, body);
    return json(result);
  } catch (error) {
    return errorResponse("Gagal membuat caption dan hashtags lewat LiteLLM Gemini proxy.", 500, error);
  }
}
