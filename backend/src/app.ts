import express, { Express } from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import passport from "passport";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { getEmailQueue } from "./queue/emailQueue";
import { config } from "./config";
import authRoutes from "./routes/auth.routes";
import emailRoutes from "./routes/email.routes";
import searchRoutes from "./routes/search.routes";
import slackRoutes from "./routes/slack.routes";

/** Built React app, if present (shared hosting with the API, same origin). */
const frontendDist = path.resolve(__dirname, "../../frontend/dist");

export function createApp(): Express {
  const app = express();

  app.use(
    cors({
      origin: config.frontendUrl,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "5mb" }));
  app.use(passport.initialize());

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, service: "reachinbox-email-scheduler", time: new Date().toISOString() });
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/emails", emailRoutes);
  app.use("/api/search", searchRoutes);
  app.use("/api/slack", slackRoutes);

  // Live BullMQ dashboard.
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({
    queues: [new BullMQAdapter(getEmailQueue())],
    serverAdapter,
  });
  app.use("/admin/queues", serverAdapter.getRouter());

  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    app.get(/^\/(?!api|admin\/).*/, (_req, res) => {
      res.sendFile(path.join(frontendDist, "index.html"));
    });
  }

  // 404 + error handler
  app.use((_req, res) => {
    res.status(404).json({ error: "Not found" });
  });
  app.use(
    (err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
      console.error("[http] unhandled error", err);
      res.status(500).json({ error: err.message ?? "Internal server error" });
    }
  );

  return app;
}