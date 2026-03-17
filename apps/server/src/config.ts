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

export function loadEnv(): AppEnv {
  const geminiApiKey = process.env.GEMINI_API_KEY?.trim() ?? "";
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const webOrigins = (process.env.WEB_ORIGIN?.trim() || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (!geminiApiKey) {
    throw new Error(
      "GEMINI_API_KEY tidak ditemukan. Isi file .env berdasarkan .env.example."
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

  return { geminiApiKey, port, webOrigins };
}
