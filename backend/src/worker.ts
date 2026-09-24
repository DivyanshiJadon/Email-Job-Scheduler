import "reflect-metadata";
import { initDb } from "./db/typeorm";
import { ensureSenders } from "./services/scheduler.service";
import { startWorker } from "./queue/worker";
import { ensureIndex } from "./services/elastic.service";
import { config } from "./config";
import { logError, logInfo } from "./utils/logger";

/**
 * Dedicated worker process. Runs the BullMQ consumer with configurable
 * concurrency. Run with `npm run dev:worker` (or `npm run start:worker`).
 */
async function bootWorker(): Promise<void> {
  await initDb();
  await ensureSenders(3);
  await ensureIndex();
  await startWorker();
  logInfo("worker", `worker ready — concurrency=${config.scheduler.workerConcurrency}`);
}

bootWorker().catch((err) => {
  logError("worker", "fatal worker error", err);
  process.exit(1);
});

process.on("SIGINT", async () => {
  logInfo("worker", "shutting down");
  process.exit(0);
});
process.on("SIGTERM", async () => {
  logInfo("worker", "shutting down");
  process.exit(0);
});