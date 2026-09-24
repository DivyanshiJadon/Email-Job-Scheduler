import { Queue } from "bullmq";
import { createRedisClient } from "./redis";
import { config } from "../config";

export const EMAIL_QUEUE_NAME = "reachinbox-email-delivery";

export interface EmailJobData {
  /** Matches EmailJob.id in MySQL. */
  jobId: string;
  /** The exact BullMQ job id that should own this row. */
  queueJobId: string;
  userId?: string | null;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  batchId?: string;
  /** 0-based position in the batch — used to preserve ordering on deferral. */
  batchIndex: number;
}

let instance: Queue | null = null;

export function getEmailQueue(): Queue {
  if (instance) return instance;

  instance = new Queue(EMAIL_QUEUE_NAME, {
    connection: createRedisClient(),
    defaultJobOptions: {
      removeOnComplete: 1000,
      removeOnFail: 2000,
      attempts: config.scheduler.jobAttempts,
      backoff: { type: "exponential", delay: 5000 },
    },
  });
  return instance;
}

/** Enqueue a single email as a delayed BullMQ job (no cron anywhere). */
export async function enqueueEmail(job: EmailJobData, delayMs: number): Promise<void> {
  const queue = getEmailQueue();
  await queue.add(
    "send-email",
    job,
    {
      jobId: job.queueJobId,
      delay: Math.max(0, delayMs),
    }
  );
}

/** Convenience when a fresh BullMQ id is needed after deferral. */
export function createQueueJobId(): string {
  const { nanoid } = require("nanoid");
  return nanoid(24);
}

/** True when a BullMQ job with this id still exists (waiting/delayed/active). */
export async function queueHasJob(jobId: string): Promise<boolean> {
  const queue = getEmailQueue();
  const job = await queue.getJob(jobId);
  if (!job) return false;
  const state = await job.getState();
  return ["waiting", "delayed", "active", "paused"].includes(state);
}

export async function closeEmailQueue(): Promise<void> {
  if (instance) {
    await instance.close();
    instance = null;
  }
}