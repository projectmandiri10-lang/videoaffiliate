import { DEFAULT_SETTINGS } from "../constants.js";
import { SETTINGS_FILE } from "../utils/paths.js";
import { JsonFile } from "../utils/json-file.js";
import type { AppSettings } from "../types.js";
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
    await this.file.set(next);
    return next;
  }
}
