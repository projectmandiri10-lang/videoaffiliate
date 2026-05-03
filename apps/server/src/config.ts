import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "./utils/paths.js";
import { DEFAULT_PORT } from "./constants.js";

dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

export interface AppEnv {
  snifoxApiBase: string;
  snifoxApiKey: string;
  geminiTtsApiKey: string;
  port: number;
  webOrigins: string[];
}

function normalizeSnifoxBase(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(
      "SNIFOX_API_BASE tidak valid. Gunakan URL penuh, contoh: https://core.snifoxai.com/v1"
    );
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = cleanPath.endsWith("/v1") ? cleanPath || "/v1" : `${cleanPath || ""}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export function loadEnv(): AppEnv {
  const snifoxApiBaseRaw =
    process.env.SNIFOX_API_BASE?.trim() ?? process.env.LITELLM_API_BASE?.trim() ?? "";
  const snifoxApiKey =
    process.env.SNIFOX_API_KEY?.trim() ?? process.env.LITELLM_API_KEY?.trim() ?? "";
  const geminiTtsApiKey =
    process.env.GEMINI_TTS_API_KEY?.trim() ?? process.env.GEMINI_API_KEY?.trim() ?? "";
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const webOrigins = (process.env.WEB_ORIGIN?.trim() || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (!snifoxApiBaseRaw) {
    throw new Error(
      "SNIFOX_API_BASE tidak ditemukan. Isi file .env berdasarkan .env.example."
    );
  }

  if (!snifoxApiKey) {
    throw new Error(
      "SNIFOX_API_KEY tidak ditemukan. Isi file .env berdasarkan .env.example."
    );
  }

  if (!geminiTtsApiKey) {
    throw new Error(
      "GEMINI_TTS_API_KEY tidak ditemukan. Isi API key Gemini untuk voice-over, atau gunakan GEMINI_API_KEY sebagai fallback."
    );
  }

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error(`PORT tidak valid: ${portRaw}`);
  }

  if (!webOrigins.length) {
    throw new Error(
      "WEB_ORIGIN tidak valid. Isi minimal satu origin, contoh: http://localhost:5173"
    );
  }

  return {
    snifoxApiBase: normalizeSnifoxBase(snifoxApiBaseRaw),
    snifoxApiKey,
    geminiTtsApiKey,
    port,
    webOrigins
  };
}
