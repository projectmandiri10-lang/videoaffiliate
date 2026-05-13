import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const ORIGINAL_ENV = {
  LITELLM_BASE_URL: process.env.LITELLM_BASE_URL,
  LITELLM_SECRET_KEY: process.env.LITELLM_SECRET_KEY,
  GEMINI_TTS_API_KEY: process.env.GEMINI_TTS_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN
};

function resetEnv() {
  if (ORIGINAL_ENV.LITELLM_BASE_URL === undefined) {
    delete process.env.LITELLM_BASE_URL;
  } else {
    process.env.LITELLM_BASE_URL = ORIGINAL_ENV.LITELLM_BASE_URL;
  }

  if (ORIGINAL_ENV.LITELLM_SECRET_KEY === undefined) {
    delete process.env.LITELLM_SECRET_KEY;
  } else {
    process.env.LITELLM_SECRET_KEY = ORIGINAL_ENV.LITELLM_SECRET_KEY;
  }

  if (ORIGINAL_ENV.GEMINI_TTS_API_KEY === undefined) {
    delete process.env.GEMINI_TTS_API_KEY;
  } else {
    process.env.GEMINI_TTS_API_KEY = ORIGINAL_ENV.GEMINI_TTS_API_KEY;
  }

  if (ORIGINAL_ENV.GEMINI_API_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
  }

  if (ORIGINAL_ENV.PORT === undefined) {
    delete process.env.PORT;
  } else {
    process.env.PORT = ORIGINAL_ENV.PORT;
  }

  if (ORIGINAL_ENV.WEB_ORIGIN === undefined) {
    delete process.env.WEB_ORIGIN;
  } else {
    process.env.WEB_ORIGIN = ORIGINAL_ENV.WEB_ORIGIN;
  }
}

describe("loadEnv", () => {
  afterEach(() => {
    resetEnv();
  });

  it("normalizes LiteLLM base URL to /v1", () => {
    process.env.LITELLM_BASE_URL = "http://localhost:4000/";
    process.env.LITELLM_SECRET_KEY = "litellm-secret";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.litellmBaseUrl).toBe("http://localhost:4000/v1");
  });

  it("keeps base URL with existing /v1 path", () => {
    process.env.LITELLM_BASE_URL = "http://localhost:4000/v1/";
    process.env.LITELLM_SECRET_KEY = "litellm-secret";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.litellmBaseUrl).toBe("http://localhost:4000/v1");
  });

  it("throws when LiteLLM env is missing", () => {
    delete process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_SECRET_KEY;
    delete process.env.GEMINI_TTS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/LITELLM_BASE_URL tidak ditemukan/i);

    process.env.LITELLM_BASE_URL = "http://localhost:4000/v1";
    expect(() => loadEnv()).toThrow(/LITELLM_SECRET_KEY tidak ditemukan/i);
  });

  it("does not use legacy Gemini env as fallback", () => {
    delete process.env.LITELLM_BASE_URL;
    delete process.env.LITELLM_SECRET_KEY;
    process.env.GEMINI_API_KEY = "gemini-legacy-test";
    process.env.GEMINI_TTS_API_KEY = "gemini-direct-test";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/LITELLM_BASE_URL tidak ditemukan/i);
  });
});
