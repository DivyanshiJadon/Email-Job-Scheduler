import { Job, Processor, Worker } from "bullmq";
import { AppDataSource } from "../db/typeorm";
import { EmailJob } from "../db/entities/EmailJob";
import { Sender } from "../db/entities/Sender";
import { config } from "../config";
import { EMAIL_QUEUE_NAME, EmailJobData, createQueueJobId, enqueueEmail, getEmailQueue } from "./emailQueue";
import { createRedisClient } from "./redis";
import { decodeSmtpConfig } from "../services/scheduler.service";
import { sendViaMailbox } from "../services/ethereal.service";
import {
  acquireSendGap,
  reserveSendSlot,
  ringRateLimitBell,
  secondsUntilNextWindow,
} from "../services/rateLimiter.service";
import { notifyRateLimitHit } from "../services/slack.service";
import { indexEmailJob } from "../services/elastic.service";
import { logError, logInfo, logWarn } from "../utils/logger";

let worker: Worker<EmailJobData> | null = null;

/**
 * Persist a row's deferral: stamps a fresh BullMQ job id, moves the row to
 * `deferred` with its new scheduledAt, and re-enqueues a delayed job.
 * The DB row is the source of truth; the queue job is just the timer.
 */
async function deferJob(row: EmailJob, delayMs: number, reason: string): Promise<void> {
  const newQueueJobId = createQueueJobId();
  row.queueJobId = newQueueJobId;
  row.status = "deferred";
  row.scheduledAt = new Date(Date.now() + delayMs);
  row.error = reason;
  await AppDataSource.getRepository(EmailJob).save(row);

  await enqueueEmail(
    {
      jobId: row.id,
      queueJobId: newQueueJobId,
      userId: row.userId,
      senderId: row.senderId,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      batchId: row.batchId ?? undefined,
      batchIndex: row.batchIndex,
    },
    delayMs
  );
  logInfo("worker", `deferred ${row.id} by ${(delayMs / 1000).toFixed(1)}s (${reason})`, {
    newQueueJobId,
    nextRun: row.scheduledAt.toISOString(),
  });
}

export const emailProcessor: Processor<EmailJobData> = async (job: Job<EmailJobData>) => {
  const { jobId, queueJobId } = job.data;
  const jobRepo = AppDataSource.getRepository(EmailJob);
  const senderRepo = AppDataSource.getRepository(Sender);

  // 1) Load source-of-truth row.
  const row = await jobRepo.findOne({ where: { id: jobId } });
  if (!row) {
    logWarn("worker", `row ${jobId} not found; skipping`);
    return;
  }

  // 2) Idempotency: only the BullMQ job that owns the row may act.
  //    Stale copies (pre-deferral jobs) are ignored.
  if (row.queueJobId !== queueJobId) {
    logInfo("worker", `stale job for ${jobId} ignored (expected ${row.queueJobId})`);
    return;
  }

  // 3) Atomic claim — guarantees a send cannot happen twice even with
  //    multiple workers or BullMQ at-least-once redelivery.
  const claim = await jobRepo
    .createQueryBuilder()
    .update(EmailJob)
    .set({ status: "processing", attempts: () => "attempts + 1" })
    .where("id = :id AND status IN (:...statuses)", { id: row.id, statuses: ["scheduled", "failed", "deferred"] })
    .execute();

  if (!claim.affected) {
    logInfo("worker", `row ${jobId} already claimed/sent; no-op`);
    return;
  }

  const sender = await senderRepo.findOne({ where: { id: row.senderId } });
  const mailbox = sender ? decodeSmtpConfig(sender) : null;
  if (!mailbox) {
    logError("worker", `no SMTP mailbox for sender ${row.senderId}`);
    row.status = "failed";
    row.error = "sender mailbox unavailable";
    await jobRepo.save(row);
    throw new Error(`sender mailbox unavailable (${row.senderId})`);
  }

  // 4) Minimum delay between individual emails (provider throttling mimic).
  const gapWaitMs = await acquireSendGap(row.senderId);
  if (gapWaitMs > 0) {
    await deferJob(row, gapWaitMs + 50, "min-delay-busy");
    return;
  }

  // 5) Hourly rate-limit check + reserve (atomic, multi-worker safe).
  const senderLimit = sender?.hourlyLimit ?? config.scheduler.maxEmailsPerHourPerSender;
  const reserve = await reserveSendSlot(row.senderId, senderLimit);
  if (!reserve.allowed) {
    const nextWindowMs = secondsUntilNextWindow() * 1000;
    // Preserve batch order "as much as possible": defer with the batchIndex
    // offset so the same relative order is kept inside the next window.
    const deferMs =
      nextWindowMs + Math.min(row.batchIndex, 60) * config.scheduler.minDelayBetweenEmailsMs;
    const isFirst = await ringRateLimitBell(row.senderId);
    if (isFirst) {
      await notifyRateLimitHit({
        userId: row.userId,
        senderId: row.senderId,
        senderEmail: sender?.email ?? row.senderId,
        recipient: row.recipient,
        channel: config.slack.channel,
        limit: senderLimit,
        retryAt: new Date(Date.now() + deferMs),
        message: `This is the first deferral in the current hour for sender \`${sender?.email ?? ""}\`.`,
      });
    }
    await deferJob(row, deferMs, "rate-limit");
    return;
  }

  // 6) Send via Ethereal SMTP.
  try {
    const result = await sendViaMailbox(mailbox, {
      to: row.recipient,
      subject: row.subject,
      html: row.body,
    });

    row.status = "sent";
    row.sentAt = new Date();
    row.providerMessageId = result.messageId;
    row.error = null;
    await jobRepo.save(row);
    void indexEmailJob(row);
    logInfo("worker", `sent ${row.id} -> ${row.recipient}`, { messageId: result.messageId });
  } catch (err) {
    row.status = "failed";
    row.error = err instanceof Error ? err.message : "send failed";
    await jobRepo.save(row);
    // Re-throw so BullMQ retries with exponential backoff up to JOB_ATTEMPTS.
    throw err;
  }
};

export async function startWorker(): Promise<void> {
  if (worker) return worker as unknown as Promise<void>;
  worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, emailProcessor, {
    connection: createRedisClient(),
    concurrency: config.scheduler.workerConcurrency,
    lockDuration: 30000,
    // Global conveyor belt: BullMQ's built-in limiter throttles dispatch to
    // `maxEmailsPerHour` over one hour so the queue never over-delivers even
    // with multiple workers. Per-sender limits are enforced separately.
    limiter: {
      max: Math.max(1, Math.floor(config.scheduler.maxEmailsPerHour / 4)),
      duration: 9000,
    },
  });

  worker.on("completed", (job) => {
    logInfo("worker", `job ${job.id} completed`);
  });
  worker.on("failed", (job, err) => {
    logWarn("worker", `job ${job?.id} failed: ${err.message}`);
  });
  worker.on("error", (err) => {
    logError("worker", "worker error", err);
  });

  logInfo("worker", `worker started (concurrency=${config.scheduler.workerConcurrency}, minDelay=${config.scheduler.minDelayBetweenEmailsMs}ms)`);
}

export async function stopWorker(): Promise<void> {
  if (worker) {
    await worker.close();
    worker = null;
  }
}

export async function getWorkerStats(): Promise<{
  concurrency: number;
  activeCount: number;
  queueName: string;
}> {
  const queue = getEmailQueue();
  const counts = await queue.getJobCounts("active", "waiting", "delayed", "completed", "failed");
  return { concurrency: worker?.concurrency ?? 0, activeCount: counts.active ?? 0, queueName: EMAIL_QUEUE_NAME };
}