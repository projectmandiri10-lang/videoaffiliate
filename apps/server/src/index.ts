import { buildApp } from "./app.js";
import { loadEnv } from "./config.js";
import { FallbackSpeechGenerator } from "./services/fallback-speech-generator.js";
import { JobProcessor } from "./services/job-processor.js";
import { GeminiContentService } from "./services/litellm-content-service.js";
import { GeminiTtsService } from "./services/litellm-tts-service.js";
import { resumeIncompleteJobs } from "./services/startup-resume.js";
import { WindowsTtsService } from "./services/windows-tts-service.js";
import { JobsStore } from "./stores/jobs-store.js";
import { SettingsStore } from "./stores/settings-store.js";
import { logger } from "./utils/logger.js";
import { ensureAppDirs } from "./utils/paths.js";

async function bootstrap(): Promise<void> {
  await ensureAppDirs();
  const env = loadEnv();

  const settingsStore = new SettingsStore();
  const jobsStore = new JobsStore();
  await jobsStore.markRunningAsInterrupted();
  await jobsStore.normalizeAll();
  const healedSourceCount = await jobsStore.healSourceVideoPaths();

  const contentService = new GeminiContentService(
    {
      apiKey: env.litellmApiKey,
      baseURL: env.litellmBaseUrl
    },
    logger
  );
  const geminiTts = new GeminiTtsService(
    {
      apiKey: env.litellmApiKey,
      baseURL: env.litellmBaseUrl
    },
    logger
  );
  const windowsTts = new WindowsTtsService(logger);
  const speechGenerator = new FallbackSpeechGenerator(windowsTts, logger, geminiTts);
  const processor = new JobProcessor(
    jobsStore,
    settingsStore,
    contentService,
    speechGenerator,
    logger
  );
  const resumedCount = await resumeIncompleteJobs(jobsStore, processor, logger);
  const app = await buildApp({
    logger,
    webOrigins: env.webOrigins,
    settingsStore,
    jobsStore,
    processor,
    speechGenerator
  });

  await app.listen({
    port: env.port,
    host: "0.0.0.0"
  });

  logger.info(`Server berjalan di http://localhost:${env.port}`);
  if (healedSourceCount > 0) {
    logger.info(
      { healedSourceCount },
      "Path source job lama diperbaiki ke folder uploads lokal."
    );
  }
  if (resumedCount > 0) {
    logger.info({ resumedCount }, "Job yang belum selesai sudah dimasukkan lagi ke antrean.");
  }
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Gagal menjalankan server.");
  process.exit(1);
});
