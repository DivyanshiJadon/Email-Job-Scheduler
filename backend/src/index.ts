import "reflect-metadata";
import { createApp } from "./app";
import { initDb } from "./db/typeorm";
import { setupPassport } from "./services/auth.service";
import { ensureSenders, getCachedSenders, reconcileQueueOnStartup, cleanupExpiredRows } from "./services/scheduler.service";
import { ensureIndex } from "./services/elastic.service";
import { config } from "./config";
import { logInfo, logError } from "./utils/logger";

async function bootstrap(): Promise<void> {
  await initDb();
  logInfo("boot", "database connected");

  setupPassport();

  await ensureSenders(3);
  const senders = await getCachedSenders();
  logInfo("boot", `sender pool ready (${senders.length} senders)`, senders.map((s) => s.email));

  // Elasticsearch is optional in the pipeline but required for search:
  // create the index; failures are tolerated and retried per request.
  await ensureIndex();

  // Restart-safe recovery: re-enqueue any pending email whose BullMQ job is
  // missing in Redis so future emails still fire at the right time.
  const reenqueued = await reconcileQueueOnStartup();
  logInfo("boot", `queue reconciliation re-enqueued ${reenqueued} pending jobs`);

  // Best-effort retention cleanup of old completed rows (not part of the
  // scheduling path; never a cron job).
  cleanupExpiredRows();

  const app = createApp();
  app.listen(config.port, () => {
    logInfo("boot", `API listening on http://localhost:${config.port}`);
    logInfo("boot", `BullMQ dashboard: http://localhost:${config.port}/admin/queues`);
  });
}

bootstrap().catch((err) => {
  logError("boot", "fatal startup error", err);
  process.exit(1);
});