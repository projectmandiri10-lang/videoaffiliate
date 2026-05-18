import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { parseRetryPlatformId, parseSelectedPlatformIds, parseSettings } from "../src/validation.js";

describe("validation", () => {
  it("accepts valid settings", () => {
    const parsed = parseSettings(DEFAULT_SETTINGS);
    expect(parsed.scriptModel).toBe(DEFAULT_SETTINGS.scriptModel);
    expect(parsed.platforms).toHaveLength(4);
    expect(parsed.ctaMode).toBe(DEFAULT_SETTINGS.ctaMode);
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

  it("parses selected platform ids from JSON string", () => {
    expect(parseSelectedPlatformIds('["youtube","tiktok","youtube"]')).toEqual([
      "tiktok",
      "youtube"
    ]);
  });

  it("rejects empty selected platform ids", () => {
    expect(() => parseSelectedPlatformIds("[]")).toThrow();
  });

  it("fills CTA defaults for legacy settings shape", () => {
    const { ctaMode: _ignoredMode, ctaSequence: _ignoredSequence, ...legacyLike } =
      DEFAULT_SETTINGS;
    const parsed = parseSettings(legacyLike);
    expect(parsed.ctaMode).toBe("random");
    expect(parsed.ctaSequence.tiktok).toBe(0);
    expect(parsed.ctaSequence.shopee).toBe(0);
  });
});
