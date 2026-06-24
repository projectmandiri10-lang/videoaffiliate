import { DEFAULT_SETTINGS } from "../constants.js";
import { pickRandomCta, pickSequentialCta, getNextSequentialCtaIndex } from "../utils/cta.js";
import { SETTINGS_FILE } from "../utils/paths.js";
import { JsonFile } from "../utils/json-file.js";
import type { AppSettings, PlatformId } from "../types.js";
import { parseSettings } from "../validation.js";

export class SettingsStore {
  private readonly file = new JsonFile<AppSettings>(SETTINGS_FILE, DEFAULT_SETTINGS);

  public async get(): Promise<AppSettings> {
    const settings = await this.file.get();
    try {
      return parseSettings(settings);
    } catch (error) {
      throw new Error(
        `Settings file tidak valid (${SETTINGS_FILE}): ${
          (error as { message?: string })?.message || "format settings tidak sesuai"
        }`
      );
    }
  }

  public async set(next: AppSettings): Promise<AppSettings> {
    const normalized = parseSettings(next);
    await this.file.set(normalized);
    return normalized;
  }

  public async pickCta(platformId: PlatformId): Promise<{
    ctaMode: AppSettings["ctaMode"];
    ctaText: string;
    ctaIndex: number;
  }> {
    const settings = await this.get();
    if (settings.ctaMode === "random") {
      const selected = pickRandomCta(platformId);
      return {
        ctaMode: settings.ctaMode,
        ctaText: selected.text,
        ctaIndex: selected.index
      };
    }

    let selectedIndex = 0;
    let selectedText = "";
    await this.file.update(async (current) => {
      const parsed = parseSettings(current);
      const nextIndex = parsed.ctaSequence[platformId] ?? 0;
      const selected = pickSequentialCta(platformId, nextIndex);
      selectedIndex = selected.index;
      selectedText = selected.text;
      return {
        ...parsed,
        ctaSequence: {
          ...parsed.ctaSequence,
          [platformId]: getNextSequentialCtaIndex(platformId, nextIndex)
        }
      };
    });

    return {
      ctaMode: settings.ctaMode,
      ctaText: selectedText,
      ctaIndex: selectedIndex
    };
  }
}
