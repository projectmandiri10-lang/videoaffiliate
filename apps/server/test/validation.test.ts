import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { parseRetryPlatformId, parseSettings } from "../src/validation.js";

describe("validation", () => {
  it("accepts valid settings", () => {
    const parsed = parseSettings(DEFAULT_SETTINGS);
    expect(parsed.scriptModel).toBe(DEFAULT_SETTINGS.scriptModel);
    expect(parsed.platforms).toHaveLength(4);
  });

  it("rejects invalid model", () => {
    expect(() =>
      parseSettings({
        ...DEFAULT_SETTINGS,
        scriptModel: ""
      })
    ).toThrow();
  });

  it("rejects unknown voice name in settings", () => {
    expect(() =>
      parseSettings({
        ...DEFAULT_SETTINGS,
        platforms: DEFAULT_SETTINGS.platforms.map((platform) =>
          platform.platformId === "tiktok"
            ? {
                ...platform,
                voiceName: "UnknownVoice"
              }
            : platform
        )
      })
    ).toThrow();
  });

  it("validates retry platform id", () => {
    expect(parseRetryPlatformId({ platformId: "shopee" })).toBe("shopee");
    expect(() => parseRetryPlatformId({ platformId: "unknown" })).toThrow();
  });
});
