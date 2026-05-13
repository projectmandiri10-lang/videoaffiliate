import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "./utils/paths.js";
import { DEFAULT_PORT } from "./constants.js";

dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

export interface AppEnv {
  litellmBaseUrl: string;
  litellmSecretKey: string;
  port: number;
  webOrigins: string[];
}

function normalizeOpenAiCompatibleBase(input: string, envName: string, example: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new Error(`${envName} tidak valid. Gunakan URL penuh, contoh: ${example}`);
  }

  const cleanPath = url.pathname.replace(/\/+$/, "");
  url.pathname = cleanPath.endsWith("/v1") ? cleanPath || "/v1" : `${cleanPath || ""}/v1`;
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeLiteLlmBase(input: string): string {
  return normalizeOpenAiCompatibleBase(
    input,
    "LITELLM_BASE_URL",
    "http://localhost:4000/v1"
  );
}

export function loadEnv(): AppEnv {
  const litellmBaseUrlRaw = process.env.LITELLM_BASE_URL?.trim() ?? "";
  const litellmSecretKey = process.env.LITELLM_SECRET_KEY?.trim() ?? "";
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const webOrigins = (process.env.WEB_ORIGIN?.trim() || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (!litellmBaseUrlRaw) {
    throw new Error(
      "LITELLM_BASE_URL tidak ditemukan. Isi endpoint LiteLLM OpenAI-compatible untuk script, caption, dan voice-over."
    );
  }

  if (!litellmSecretKey) {
    throw new Error(
      "LITELLM_SECRET_KEY tidak ditemukan. Isi secret LiteLLM untuk akses model."
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
    litellmBaseUrl: normalizeLiteLlmBase(litellmBaseUrlRaw),
    litellmSecretKey,
    port,
    webOrigins
  };
}
