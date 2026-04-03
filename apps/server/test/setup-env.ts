import path from "node:path";
import { fileURLToPath } from "node:url";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.APP_STORAGE_ROOT) {
  process.env.APP_STORAGE_ROOT = path.resolve(CURRENT_DIR, "../.test-runtime");
}
