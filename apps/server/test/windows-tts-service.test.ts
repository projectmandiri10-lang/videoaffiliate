import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import pino from "pino";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import { WindowsTtsService } from "../src/services/windows-tts-service.js";

describe("WindowsTtsService", () => {
  const logger = pino({ level: "silent" });

  it("returns generated wav data from the PowerShell runner", async () => {
    const runner = vi.fn(async (input) => {
      await mkdir(path.dirname(input.outputPath), { recursive: true });
      await writeFile(input.outputPath, "wav-data", "utf8");
    });
    const service = new WindowsTtsService(
      logger,
      runner,
      "win32"
    );

    const result = await service.generateSpeech({
      model: "gemini-2.5-flash-preview-tts",
      text: "Halo",
      voiceName: "Kore",
      speechRate: 1
    });

    expect(result.data.toString("utf8")).toBe("wav-data");
    expect(result.mimeType).toBe("audio/wav");
    expect(runner).toHaveBeenCalledWith(
      expect.objectContaining({
        allowAnyVoice: false,
        preferredCulturePrefix: "id"
      })
    );
  });
});
