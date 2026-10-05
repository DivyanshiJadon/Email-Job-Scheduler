import "reflect-metadata";
import { createApp, servesFrontend } from "./app";
import { initDb } from "./db/typeorm";
import { setupPassport } from "./services/auth.service";
import { ensureSenders, getCachedSenders, reconcileQueueOnStartup, cleanupExpiredRows } from "./services/scheduler.service";
import { ensureIndex } from "./services/elastic.service";
import { config, isLocalOrigin } from "./config";
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
  logInfo("boot", `public urls frontend=${config.frontendUrl} backend=${config.backendUrl}`);
  logInfo("boot", `google oauth callback=${config.auth.googleRedirectUri ?? "not configured"}`);

  const primaryFrontend = config.frontendUrl.split(",")[0].trim();
  const hostOf = (url: string): string | null => {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  };

  if (isLocalOrigin(primaryFrontend)) {
    logError(
      "boot",
      `FRONTEND_URL points at localhost (${primaryFrontend}); sign-in will redirect off-site. Set FRONTEND_URL to the public URL.`
    );
  } else if (
    servesFrontend() &&
    hostOf(primaryFrontend) !== null &&
    hostOf(primaryFrontend) !== hostOf(config.backendUrl)
  ) {
    logError(
      "boot",
      `This process serves the built SPA at ${config.backendUrl}, but FRONTEND_URL is ${primaryFrontend}. Sign-in will redirect to ${primaryFrontend}. Unset FRONTEND_URL to use this host.`
    );
  }

  // app.listen without a host binds every interface, so the port is reachable
  // from outside the container; the log reports the URL that actually works.
  app.listen(config.port, () => {
    logInfo("boot", `API listening on port ${config.port}, reachable at ${config.backendUrl}`);
    logInfo("boot", `BullMQ dashboard: ${config.backendUrl}/admin/queues`);
  });
}

bootstrap().catch((err) => {
  logError("boot", "fatal startup error", err);
  process.exit(1);
});