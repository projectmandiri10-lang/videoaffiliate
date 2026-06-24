import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "./utils/paths.js";
import { DEFAULT_PORT } from "./constants.js";

dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

export interface AppEnv {
  geminiApiKey: string;
  port: number;
  webOrigins: string[];
}

function normalizeApiKey(input: string, envName: string): string {
  const clean = input.trim();
  if (!clean) {
    throw new Error(`${envName} tidak valid. Isi dengan Gemini API key yang aktif.`);
  }
  return clean;
}

export function loadEnv(): AppEnv {
  const geminiApiKeyRaw =
    process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim() || "";
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const webOrigins = (process.env.WEB_ORIGIN?.trim() || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (!geminiApiKeyRaw) {
    throw new Error(
      "GEMINI_API_KEY tidak ditemukan. Isi Gemini API key langsung dari Google AI Studio atau set GOOGLE_API_KEY."
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
    geminiApiKey: normalizeApiKey(geminiApiKeyRaw, "GEMINI_API_KEY"),
    port,
    webOrigins
  };
}
