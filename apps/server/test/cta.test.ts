import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/constants.js";
import { PLATFORM_CONFIG } from "../src/platform-config.js";
import { SettingsStore } from "../src/stores/settings-store.js";
import { resetTestStorage } from "./helpers.js";

describe("cta settings", () => {
  const settingsStore = new SettingsStore();

  beforeEach(async () => {
    await resetTestStorage();
    await settingsStore.set(DEFAULT_SETTINGS);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rotates CTA sequentially per platform", async () => {
    await settingsStore.set({
      ...DEFAULT_SETTINGS,
      ctaMode: "sequential",
      ctaSequence: {
        tiktok: 0,
        youtube: 0,
        facebook: 0,
        shopee: 0
      }
    });

    const first = await settingsStore.pickCta("facebook");
    const second = await settingsStore.pickCta("facebook");
    const saved = await settingsStore.get();

    expect(first.ctaText).toBe(PLATFORM_CONFIG.facebook.ctaVariants[0]);
    expect(second.ctaText).toBe(PLATFORM_CONFIG.facebook.ctaVariants[1]);
    expect(saved.ctaSequence.facebook).toBe(2);
  });

  it("picks random CTA without advancing sequence state", async () => {
    vi.spyOn(Math, "random").mockReturnValue(0.9);

    const selected = await settingsStore.pickCta("tiktok");
    const saved = await settingsStore.get();

    expect(PLATFORM_CONFIG.tiktok.ctaVariants).toContain(selected.ctaText);
    expect(saved.ctaSequence.tiktok).toBe(0);
  });
});
