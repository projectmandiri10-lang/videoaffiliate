import { GEMINI_EXCITED_PRESETS, GEMINI_TTS_VOICES } from "@app/core";
import { json } from "../../_lib/response";

export function onRequestGet() {
  return json({
    voices: GEMINI_TTS_VOICES,
    excitedPresets: GEMINI_EXCITED_PRESETS
  });
}
