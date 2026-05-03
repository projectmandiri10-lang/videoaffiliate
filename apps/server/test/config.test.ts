import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const ORIGINAL_ENV = {
  SNIFOX_API_BASE: process.env.SNIFOX_API_BASE,
  SNIFOX_API_KEY: process.env.SNIFOX_API_KEY,
  GEMINI_TTS_API_KEY: process.env.GEMINI_TTS_API_KEY,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  LITELLM_API_BASE: process.env.LITELLM_API_BASE,
  LITELLM_API_KEY: process.env.LITELLM_API_KEY,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN
};

function resetEnv() {
  if (ORIGINAL_ENV.SNIFOX_API_BASE === undefined) {
    delete process.env.SNIFOX_API_BASE;
  } else {
    process.env.SNIFOX_API_BASE = ORIGINAL_ENV.SNIFOX_API_BASE;
  }

  if (ORIGINAL_ENV.SNIFOX_API_KEY === undefined) {
    delete process.env.SNIFOX_API_KEY;
  } else {
    process.env.SNIFOX_API_KEY = ORIGINAL_ENV.SNIFOX_API_KEY;
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

  if (ORIGINAL_ENV.LITELLM_API_BASE === undefined) {
    delete process.env.LITELLM_API_BASE;
  } else {
    process.env.LITELLM_API_BASE = ORIGINAL_ENV.LITELLM_API_BASE;
  }

  if (ORIGINAL_ENV.LITELLM_API_KEY === undefined) {
    delete process.env.LITELLM_API_KEY;
  } else {
    process.env.LITELLM_API_KEY = ORIGINAL_ENV.LITELLM_API_KEY;
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
    process.env.LITELLM_API_BASE = "http://localhost:4000";
    process.env.LITELLM_API_KEY = "sk-test";
    process.env.GEMINI_TTS_API_KEY = "gemini-tts-test";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.llmApiBase).toBe("http://localhost:4000/v1");
  });

  it("keeps base URL with existing /v1 path", () => {
    process.env.LITELLM_API_BASE = "http://localhost:4000/v1/";
    process.env.LITELLM_API_KEY = "sk-test";
    process.env.GEMINI_TTS_API_KEY = "gemini-tts-test";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.llmApiBase).toBe("http://localhost:4000/v1");
  });

  it("throws when LiteLLM env is missing", () => {
    delete process.env.SNIFOX_API_BASE;
    delete process.env.SNIFOX_API_KEY;
    delete process.env.GEMINI_TTS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    delete process.env.LITELLM_API_BASE;
    delete process.env.LITELLM_API_KEY;
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/LITELLM_API_BASE tidak ditemukan/i);

    process.env.LITELLM_API_BASE = "http://localhost:4000/v1";
    expect(() => loadEnv()).toThrow(/LITELLM_API_KEY tidak ditemukan/i);
  });

  it("requires a Gemini TTS key for voice-over", () => {
    process.env.LITELLM_API_BASE = "http://localhost:4000/v1";
    process.env.LITELLM_API_KEY = "sk-test";
    delete process.env.GEMINI_TTS_API_KEY;
    delete process.env.GEMINI_API_KEY;
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/GEMINI_TTS_API_KEY tidak ditemukan/i);
  });

  it("supports GEMINI_API_KEY as fallback for TTS", () => {
    process.env.LITELLM_API_BASE = "http://localhost:4000/v1";
    process.env.LITELLM_API_KEY = "sk-test";
    delete process.env.GEMINI_TTS_API_KEY;
    process.env.GEMINI_API_KEY = "gemini-legacy-test";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.geminiTtsApiKey).toBe("gemini-legacy-test");
  });

  it("still supports legacy SNIFOX env names as fallback", () => {
    delete process.env.LITELLM_API_BASE;
    delete process.env.LITELLM_API_KEY;
    process.env.SNIFOX_API_BASE = "https://core.snifoxai.com";
    process.env.SNIFOX_API_KEY = "snfx-test";
    process.env.GEMINI_TTS_API_KEY = "gemini-tts-test";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.llmApiBase).toBe("https://core.snifoxai.com/v1");
    expect(env.llmApiKey).toBe("snfx-test");
  });
});
