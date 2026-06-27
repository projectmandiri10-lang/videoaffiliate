import { generateTts } from "../../_lib/gemini";
import { errorResponse, json } from "../../_lib/response";

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

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
    const body = (await context.request.json()) as {
      model: string;
      text: string;
      voiceName: string;
      speechRate: number;
    };
    const audio = await generateTts(context.env, body);
    return json({
      mimeType: audio.mimeType,
      audioBase64: encodeBase64(audio.data)
    });
  } catch (error) {
    return errorResponse("Gagal membuat TTS lewat LiteLLM Gemini proxy.", 500, error);
  }
}
