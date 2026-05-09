import { buildApp } from "./app.js";
import { loadEnv } from "./config.js";
import { FallbackSpeechGenerator } from "./services/fallback-speech-generator.js";
import { JobProcessor } from "./services/job-processor.js";
import { LiteLlmTtsService } from "./services/litellm-tts-service.js";
import { SnifoxService } from "./services/snifox-service.js";
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

  const snifox = new SnifoxService(env.snifoxApiBase, env.snifoxApiKey, logger);
  const liteLlmTts = new LiteLlmTtsService(env.litellmBaseUrl, env.litellmSecretKey, logger);
  const windowsTts = new WindowsTtsService(logger);
  const speechGenerator = new FallbackSpeechGenerator(windowsTts, logger, liteLlmTts);
  const processor = new JobProcessor(
    jobsStore,
    settingsStore,
    snifox,
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
  if (resumedCount > 0) {
    logger.info({ resumedCount }, "Job yang belum selesai sudah dimasukkan lagi ke antrean.");
  }
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Gagal menjalankan server.");
  process.exit(1);
});
