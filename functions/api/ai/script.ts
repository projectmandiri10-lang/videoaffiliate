import { errorResponse, json } from "../../_lib/response";
import { generateScript } from "../../_lib/gemini";

export async function onRequestPost(context: {
  request: Request;
  env: { GEMINI_API_KEY?: string; GOOGLE_API_KEY?: string };
}) {
  try {
    const body = (await context.request.json()) as {
      model: string;
      prompt: string;
      frames: Array<{ dataUrl: string; timestampSec: number }>;
    };
    const script = await generateScript(context.env, body);
    return json({ script });
  } catch (error) {
    return errorResponse("Gagal membuat script lewat Gemini proxy.", 500, error);
  }
}
