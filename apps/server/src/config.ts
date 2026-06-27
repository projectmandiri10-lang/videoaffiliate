import dotenv from "dotenv";
import path from "node:path";
import { ROOT_DIR } from "./utils/paths.js";
import { DEFAULT_PORT } from "./constants.js";

dotenv.config({ path: path.join(ROOT_DIR, ".env"), override: true });

export interface AppEnv {
  litellmApiKey: string;
  litellmBaseUrl: string;
  port: number;
  webOrigins: string[];
}

function normalizeApiKey(input: string, envName: string): string {
  const clean = input.trim();
  if (!clean) {
    throw new Error(`${envName} tidak valid. Isi dengan LiteLLM API key yang aktif.`);
  }
  return clean;
}

function normalizeBaseUrl(input: string): string {
  const clean = input.trim().replace(/\/+$/, "");
  if (!clean) {
    throw new Error("LITELLM_BASE_URL tidak valid.");
  }

  let parsed: URL;
  try {
    parsed = new URL(clean);
  } catch {
    throw new Error(
      "LITELLM_BASE_URL tidak valid. Contoh: http://127.0.0.1:4000 atau https://litellm.example.com"
    );
  }

  if (!parsed.pathname || parsed.pathname === "/") {
    parsed.pathname = "/v1";
  } else if (!parsed.pathname.endsWith("/v1")) {
    parsed.pathname = `${parsed.pathname.replace(/\/+$/, "")}/v1`;
  }

  return parsed.toString().replace(/\/$/, "");
}

export function loadEnv(): AppEnv {
  const litellmApiKeyRaw =
    process.env.LITELLM_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || "";
  const litellmBaseUrlRaw =
    process.env.LITELLM_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || "";
  const portRaw = process.env.PORT?.trim();
  const port = portRaw ? Number(portRaw) : DEFAULT_PORT;
  const webOrigins = (process.env.WEB_ORIGIN?.trim() || "http://localhost:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  if (!litellmBaseUrlRaw) {
    throw new Error(
      "LITELLM_BASE_URL tidak ditemukan. Arahkan ke endpoint LiteLLM Anda, misalnya http://127.0.0.1:4000."
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
    litellmApiKey: litellmApiKeyRaw
      ? normalizeApiKey(litellmApiKeyRaw, "LITELLM_API_KEY")
      : "litellm-no-auth",
    litellmBaseUrl: normalizeBaseUrl(litellmBaseUrlRaw),
    port,
    webOrigins
  };
}
