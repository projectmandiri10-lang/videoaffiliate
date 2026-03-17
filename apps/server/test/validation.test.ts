import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { parseRetryStyleId, parseSettings } from "../src/validation.js";

describe("validation", () => {
  it("accepts valid settings", () => {
    const parsed = parseSettings(DEFAULT_SETTINGS);
    expect(parsed.scriptModel).toBe(DEFAULT_SETTINGS.scriptModel);
    expect(parsed.styles).toHaveLength(4);
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
        styles: DEFAULT_SETTINGS.styles.map((style) =>
          style.styleId === "evergreen"
            ? {
                ...style,
                voiceName: "UnknownVoice"
              }
            : style
        )
      })
    ).toThrow();
  });

  it("validates retry style id", () => {
    expect(parseRetryStyleId({ styleId: "hard_selling" })).toBe("hard_selling");
    expect(() => parseRetryStyleId({ styleId: "unknown" })).toThrow();
  });
});
