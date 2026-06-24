import { afterEach, describe, expect, it } from "vitest";
import { loadEnv } from "../src/config.js";

const ORIGINAL_ENV = {
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  GOOGLE_API_KEY: process.env.GOOGLE_API_KEY,
  PORT: process.env.PORT,
  WEB_ORIGIN: process.env.WEB_ORIGIN
};

function resetEnv() {
  if (ORIGINAL_ENV.GEMINI_API_KEY === undefined) {
    delete process.env.GEMINI_API_KEY;
  } else {
    process.env.GEMINI_API_KEY = ORIGINAL_ENV.GEMINI_API_KEY;
  }

  if (ORIGINAL_ENV.GOOGLE_API_KEY === undefined) {
    delete process.env.GOOGLE_API_KEY;
  } else {
    process.env.GOOGLE_API_KEY = ORIGINAL_ENV.GOOGLE_API_KEY;
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

  it("reads Gemini API key directly", () => {
    process.env.GEMINI_API_KEY = "gemini-secret";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.geminiApiKey).toBe("gemini-secret");
  });

  it("falls back to GOOGLE_API_KEY when Gemini API key is not set", () => {
    delete process.env.GEMINI_API_KEY;
    process.env.GOOGLE_API_KEY = "google-secret";
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    const env = loadEnv();
    expect(env.geminiApiKey).toBe("google-secret");
  });

  it("throws when Gemini env is missing", () => {
    delete process.env.GEMINI_API_KEY;
    delete process.env.GOOGLE_API_KEY;
    process.env.PORT = "8787";
    process.env.WEB_ORIGIN = "http://localhost:5173";

    expect(() => loadEnv()).toThrow(/GEMINI_API_KEY tidak ditemukan/i);
  });
});
