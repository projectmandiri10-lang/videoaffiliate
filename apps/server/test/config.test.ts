import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const ORIGINAL_ENV = {
  LITELLM_API_KEY: process.env.LITELLM_API_KEY,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  LITELLM_BASE_URL: process.env.LITELLM_BASE_URL,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN
};

function resetEnv() {
  if (ORIGINAL_ENV.LITELLM_API_KEY === undefined) {
    delete process.env.LITELLM_API_KEY;
  } else {
    process.env.LITELLM_API_KEY = ORIGINAL_ENV.LITELLM_API_KEY;
  }

  if (ORIGINAL_ENV.OPENAI_API_KEY === undefined) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = ORIGINAL_ENV.OPENAI_API_KEY;
  }

  if (ORIGINAL_ENV.LITELLM_BASE_URL === undefined) {
    delete process.env.LITELLM_BASE_URL;
  } else {
    process.env.LITELLM_BASE_URL = ORIGINAL_ENV.LITELLM_BASE_URL;
  }

  if (ORIGINAL_ENV.OPENAI_BASE_URL === undefined) {
    delete process.env.OPENAI_BASE_URL;
  } else {
    process.env.OPENAI_BASE_URL = ORIGINAL_ENV.OPENAI_BASE_URL;
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

  it("reads LiteLLM config directly", () => {
    process.env.LITELLM_API_KEY = "litellm-secret";
    process.env.LITELLM_BASE_URL = "http://127.0.0.1:4000";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.litellmApiKey).toBe("litellm-secret");
    expect(env.litellmBaseUrl).toBe("http://127.0.0.1:4000/v1");
  });

  it("falls back to OPENAI_* aliases when LiteLLM env is not set", () => {
    delete process.env.LITELLM_API_KEY;
    delete process.env.LITELLM_BASE_URL;
    process.env.OPENAI_API_KEY = "openai-secret";
    process.env.OPENAI_BASE_URL = "https://litellm.example.com/custom";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.litellmApiKey).toBe("openai-secret");
    expect(env.litellmBaseUrl).toBe("https://litellm.example.com/custom/v1");
  });

  it("uses a dummy key when LiteLLM auth is disabled", () => {
    delete process.env.LITELLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    process.env.LITELLM_BASE_URL = "http://127.0.0.1:4000/v1";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.litellmApiKey).toBe("litellm-no-auth");
  });

  it("throws when LiteLLM base URL is missing", () => {
    delete process.env.LITELLM_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.LITELLM_BASE_URL;
    delete process.env.OPENAI_BASE_URL;
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/LITELLM_BASE_URL tidak ditemukan/i);
  });
});
