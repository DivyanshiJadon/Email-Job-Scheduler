import { nanoid } from "nanoid";
import { In } from "typeorm";
import { AppDataSource } from "../db/typeorm";
import { EmailJob } from "../db/entities/EmailJob";
import { Sender } from "../db/entities/Sender";
import { config } from "../config";
import { enqueueEmail, getEmailQueue, queueHasJob, createQueueJobId } from "../queue/emailQueue";
import { Mailbox, provisionSenderPool } from "./ethereal.service";
import { indexEmailJob } from "./elastic.service";
import { logInfo, logWarn } from "../utils/logger";

export interface ScheduleBatchInput {
  userId: string | null;
  subject: string;
  body: string;
  /** Unique email addresses to send to. */
  leads: string[];
  /** ISO timestamp when the first email is scheduled. */
  startTime: string;
  /** Seconds between individual emails inside the batch. */
  delayBetweenEmailsMs: number;
  /** Optional per-batch hourly cap (clamped to the configured maximum). */
  hourlyLimit?: number;
  senderId?: string;
}

export interface ScheduleBatchResult {
  batchId: string;
  total: number;
  valid: number;
  alreadyScheduled: number;
  firstScheduledAt: string | null;
}

/** Ensures the configured number of Ethereal sender mailboxes exist in DB. */
export async function ensureSenders(count = 3): Promise<Sender[]> {
  const repo = AppDataSource.getRepository(Sender);
  let senders = await repo.find({ order: { createdAt: "ASC" } });
  if (senders.length >= count) return senders;

  const mailboxes = await provisionSenderPool(count);
  const existing = new Set(senders.map((s) => s.email.toLowerCase()));
  for (const mailbox of mailboxes) {
    if (existing.has(mailbox.email.toLowerCase())) continue;
    const sender = repo.create({
      name: mailbox.name,
      email: mailbox.email,
      smtpConfig: JSON.stringify({
        user: mailbox.user,
        pass: mailbox.pass,
        host: mailbox.host,
        port: mailbox.port,
      }),
    });
    await repo.save(sender);
    senders.push(sender);
    existing.add(sender.email.toLowerCase());
  }
  return senders;
}

export async function getCachedSenders(): Promise<Sender[]> {
  const repo = AppDataSource.getRepository(Sender);
  const senders = await repo.find({ where: { active: true } });
  if (senders.length === 0) return ensureSenders();
  return senders;
}

export function decodeSmtpConfig(sender: Sender): Mailbox | null {
  if (!sender.smtpConfig) return null;
  try {
    const parsed = JSON.parse(sender.smtpConfig) as Omit<Mailbox, "email" | "name">;
    return { ...parsed, email: sender.email, name: sender.name };
  } catch {
    return null;
  }
}

/** Simple round-robin across active senders. */
export function pickSender(senders: Sender[], preferredId?: string): Sender | null {
  if (preferredId) {
    const match = senders.find((s) => s.id === preferredId);
    if (match) return match;
  }
  if (senders.length === 0) return null;
  return senders[Math.floor(Math.random() * senders.length)];
}

/**
 * Core scheduling entrypoint.
 *
 * Durability strategy: rows are persisted in MySQL first (source of truth),
 * and only then are BullMQ delayed jobs enqueued. Queue job ids are stamped
 * on the row so restarts can reconcile exactly.
 */
export async function scheduleBatch(input: ScheduleBatchInput): Promise<ScheduleBatchResult> {
  const senders = await getCachedSenders();
  const sender = pickSender(senders, input.senderId);
  if (!sender) throw new Error("No active sender available");

  // Apply the batch's hourly limit to the sender (clamped to the env cap).
  if (input.hourlyLimit && input.hourlyLimit > 0) {
    sender.hourlyLimit = Math.min(
      input.hourlyLimit,
      config.scheduler.maxEmailsPerHourPerSender
    );
    await AppDataSource.getRepository(Sender).save(sender);
  }

  const batchId = nanoid(12);
  const start = new Date(input.startTime);
  const now = Date.now();
  const gapMs = Math.max(config.scheduler.minDelayBetweenEmailsMs, input.delayBetweenEmailsMs);

  const leads = Array.from(new Set(input.leads.map((l) => l.trim().toLowerCase())));
  const repo = AppDataSource.getRepository(EmailJob);

  const rows: EmailJob[] = [];
  for (let i = 0; i < leads.length; i++) {
    const jobId = nanoid(21);
    const scheduledAt = new Date(start.getTime() + i * gapMs);
    const queueJobId = createQueueJobId();
    rows.push(
      repo.create({
        id: jobId,
        batchId,
        userId: input.userId,
        senderId: sender.id,
        recipient: leads[i],
        subject: input.subject,
        body: input.body,
        status: "scheduled",
        scheduledAt,
        batchIndex: i,
        queueJobId,
      })
    );
  }

  // 1) Persist everything first.
  await repo.save(rows);

  // 2) Enqueue BullMQ jobs (still within the persist-first guarantee).
  for (const row of rows) {
    const delayMs = new Date(row.scheduledAt).getTime() - now;
    try {
      await enqueueEmail(
        {
          jobId: row.id,
          queueJobId: row.queueJobId!,
          userId: row.userId,
          senderId: row.senderId,
          recipient: row.recipient,
          subject: row.subject,
          body: row.body,
          batchId: row.batchId!,
          batchIndex: row.batchIndex,
        },
        delayMs
      );
    } catch (err) {
      logWarn("scheduler", `enqueue failed for ${row.id}; marking failed`, err);
      row.status = "failed";
      row.error = err instanceof Error ? err.message : "enqueue failed";
      await repo.save(row);
    }
  }

  // Fire-and-forget indexing is safe (ES down -> pipeline unaffected).
  for (const row of rows) void indexEmailJob(row);

  logInfo("scheduler", `scheduled batch ${batchId} with ${rows.length} emails`, {
    senderId: sender.id,
    firstScheduledAt: rows[0]?.scheduledAt.toISOString(),
  });

  return {
    batchId,
    total: rows.length,
    valid: rows.filter((r) => r.status === "scheduled").length,
    alreadyScheduled: 0,
    firstScheduledAt: rows[0]?.scheduledAt.toISOString() ?? null,
  };
}

export interface EmailListResult {
  data: EmailJob[];
  total: number;
}

export async function listScheduledEmails(opts: {
  userId?: string;
  from?: number;
  size?: number;
}): Promise<EmailListResult> {
  const repo = AppDataSource.getRepository(EmailJob);
  const [data, total] = await repo.findAndCount({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      status: In(["scheduled", "deferred", "processing"]),
    },
    order: { scheduledAt: "ASC" },
    skip: opts.from ?? 0,
    take: Math.min(opts.size ?? 50, 200),
  });
  return { data, total };
}

export async function listSentEmails(opts: {
  userId?: string;
  from?: number;
  size?: number;
}): Promise<EmailListResult> {
  const repo = AppDataSource.getRepository(EmailJob);
  const [data, total] = await repo.findAndCount({
    where: {
      ...(opts.userId ? { userId: opts.userId } : {}),
      status: In(["sent", "failed"]),
    },
    order: { sentAt: "DESC" },
    skip: opts.from ?? 0,
    take: Math.min(opts.size ?? 50, 200),
  });
  return { data, total };
}

export async function getJobById(id: string, userId?: string): Promise<EmailJob | null> {
  const repo = AppDataSource.getRepository(EmailJob);
  return repo.findOne({ where: { id, ...(userId ? { userId } : {}) } });
}

/**
 * Startup reconciliation — guarantees the "restart-safe" contract.
 *
 * For every row still awaiting delivery whose exact BullMQ job is missing
 * from Redis (e.g. the queue was flushed, a delayed job was dropped, or the
 * process died mid-enqueue), we re-enqueue it with the correct remaining
 * delay. Rows whose job still exists are left untouched, so emails are never
 * duplicated.
 */
export async function reconcileQueueOnStartup(maxRows = 50000): Promise<number> {
  const repo = AppDataSource.getRepository(EmailJob);
  const rows = await repo.find({
    where: { status: In(["scheduled", "deferred"]) },
    order: { scheduledAt: "ASC" },
    take: maxRows,
  });

  let reenqueued = 0;
  for (const row of rows) {
    try {
      const hasJob = row.queueJobId ? await queueHasJob(row.queueJobId) : false;
      if (hasJob) continue;
      const queueJobId = createQueueJobId();
      row.queueJobId = queueJobId;
      await repo.save(row);
      await enqueueEmail(
        {
          jobId: row.id,
          queueJobId,
          userId: row.userId,
          senderId: row.senderId,
          recipient: row.recipient,
          subject: row.subject,
          body: row.body,
          batchId: row.batchId!,
          batchIndex: row.batchIndex,
        },
        new Date(row.scheduledAt).getTime() - Date.now()
      );
      reenqueued++;
    } catch (err) {
      logWarn("scheduler", `reconcile failed for ${row.id}`, err);
    }
  }
  logInfo("scheduler", `reconciliation complete: ${reenqueued}/${rows.length} re-enqueued`);
  return reenqueued;
}

export function cleanupExpiredRows(olderThanDays = 30): void {
  const repo = AppDataSource.getRepository(EmailJob);
  const threshold = new Date(Date.now() - olderThanDays * 86400000);
  void repo
    .createQueryBuilder()
    .delete()
    .from(EmailJob)
    .where("status IN (:...statuses)", {
      statuses: ["sent", "failed"],
    })
    .andWhere("sentAt <= :threshold", { threshold })
    .execute();
}