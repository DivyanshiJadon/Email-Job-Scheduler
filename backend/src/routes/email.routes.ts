import { Router, Request, Response } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.middleware";
import { extractEmailsFromText } from "../utils/csv";
import { config } from "../config";
import {
  getJobById,
  listScheduledEmails,
  listSentEmails,
  scheduleBatch,
} from "../services/scheduler.service";

const router = Router();

router.use(requireAuth);

const scheduleSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  leads: z.array(z.string().email()).optional(),
  csvText: z.string().optional(),
  startTime: z.string().datetime({ offset: true }),
  delayBetweenEmails: z.number().int().min(0).max(3600).default(2),
  hourlyLimit: z.number().int().min(1).max(10000).optional(),
  senderId: z.string().uuid().optional(),
});

router.post("/schedule", async (req: Request, res: Response) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload", details: parsed.error.flatten() });
  }

  const data = parsed.data;
  const leads = data.leads?.length
    ? data.leads
    : extractEmailsFromText(data.csvText ?? "");

  if (leads.length === 0) {
    return res.status(400).json({ error: "No valid email addresses found" });
  }

  const start = new Date(data.startTime);
  if (Number.isNaN(start.getTime())) {
    return res.status(400).json({ error: "Invalid startTime" });
  }

  // Effective per-sender hourly cap: min(batch setting, global env cap).
  const effectiveLimit = Math.min(
    data.hourlyLimit ?? config.scheduler.maxEmailsPerHourPerSender,
    config.scheduler.maxEmailsPerHourPerSender
  );

  const result = await scheduleBatch({
    userId: req.auth?.sub ?? null,
    subject: data.subject,
    body: data.body,
    leads,
    startTime: start.toISOString(),
    delayBetweenEmailsMs: data.delayBetweenEmails * 1000,
    hourlyLimit: effectiveLimit,
    senderId: data.senderId,
  });

  return res.status(201).json(result);
});

router.get("/scheduled", async (req: Request, res: Response) => {
  const from = parseInt((req.query.from as string) ?? "0", 10) || 0;
  const size = Math.min(parseInt((req.query.size as string) ?? "50", 10) || 50, 200);
  const result = await listScheduledEmails({ userId: req.auth?.sub, from, size });
  res.json(result);
});

router.get("/sent", async (req: Request, res: Response) => {
  const from = parseInt((req.query.from as string) ?? "0", 10) || 0;
  const size = Math.min(parseInt((req.query.size as string) ?? "50", 10) || 50, 200);
  const result = await listSentEmails({ userId: req.auth?.sub, from, size });
  res.json(result);
});

router.get("/:id", async (req: Request, res: Response) => {
  const job = await getJobById(req.params.id, req.auth?.sub);
  if (!job) return res.status(404).json({ error: "Email not found" });
  res.json(job);
});

export default router;