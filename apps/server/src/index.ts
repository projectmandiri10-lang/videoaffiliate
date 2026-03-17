import { buildApp } from "./app.js";
import { loadEnv } from "./config.js";
import { JobProcessor } from "./services/job-processor.js";
import { GeminiService } from "./services/gemini-service.js";
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

  const gemini = new GeminiService(env.geminiApiKey, logger);
  const processor = new JobProcessor(jobsStore, settingsStore, gemini, logger);
  const app = await buildApp({
    logger,
    webOrigins: env.webOrigins,
    settingsStore,
    jobsStore,
    processor,
    speechGenerator: gemini
  });

  await app.listen({
    port: env.port,
    host: "0.0.0.0"
  });

  logger.info(`Server berjalan di http://localhost:${env.port}`);
}

bootstrap().catch((error) => {
  logger.error({ err: error }, "Gagal menjalankan server.");
  process.exit(1);
});
