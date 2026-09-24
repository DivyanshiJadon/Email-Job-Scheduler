import { Client } from "@elastic/elasticsearch";
import { config } from "../config";
import { AppDataSource } from "../db/typeorm";
import { EmailJob } from "../db/entities/EmailJob";
import { logError, logInfo } from "../utils/logger";

let client: Client | null = null;
let indexReady = false;

export function getEsClient(): Client {
  if (!client) {
    client = new Client({ node: config.elasticsearch.node, requestTimeout: 5000 });
  }
  return client;
}

export interface EmailDocument {
  jobId: string;
  batchId?: string | null;
  userId: string | null;
  senderId: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt?: string | null;
  providerMessageId?: string | null;
}

export async function ensureIndex(): Promise<void> {
  if (indexReady) return;
  try {
    const es = getEsClient();
    const exists = await es.indices.exists({ index: config.elasticsearch.index });
    if (!exists) {
      await es.indices.create({
        index: config.elasticsearch.index,
        mappings: {
          properties: {
            jobId: { type: "keyword" },
            batchId: { type: "keyword" },
            userId: { type: "keyword" },
            senderId: { type: "keyword" },
            recipient: { type: "keyword", fields: { text: { type: "text" } } },
            subject: { type: "text", fields: { keyword: { type: "keyword" } } },
            body: { type: "text" },
            status: { type: "keyword" },
            scheduledAt: { type: "date" },
            sentAt: { type: "date" },
            providerMessageId: { type: "keyword" },
          },
        },
      });
      logInfo("elasticsearch", `created index ${config.elasticsearch.index}`);
    }
    indexReady = true;
  } catch (err) {
    logError("elasticsearch", "ensureIndex failed (will retry on next call)", err);
  }
}

/** Index (upsert) a job document. Fail-open: never blocks the email pipeline. */
export async function indexEmailJob(job: EmailJob): Promise<void> {
  await ensureIndex();
  const doc: EmailDocument = {
    jobId: job.id,
    batchId: job.batchId,
    userId: job.userId,
    senderId: job.senderId,
    recipient: job.recipient,
    subject: job.subject,
    body: job.body,
    status: job.status,
    scheduledAt: job.scheduledAt.toISOString(),
    sentAt: job.sentAt ? job.sentAt.toISOString() : null,
    providerMessageId: job.providerMessageId,
  };
  try {
    await getEsClient().index({
      index: config.elasticsearch.index,
      id: job.id,
      document: doc,
      refresh: "wait_for",
    });
  } catch (err) {
    logError("elasticsearch", "indexEmailJob failed", err);
  }
}

export interface SearchResult {
  total: number;
  hits: Array<EmailDocument & { score?: number }>;
}

export async function searchEmails(q: string, from = 0, size = 50): Promise<SearchResult> {
  await ensureIndex();
  const es = getEsClient();
  const query = {
    bool: {
      must: q
        ? {
            bool: {
              should: [
                {
                  multi_match: {
                    query: q,
                    fields: ["recipient.text^3", "subject^2", "body"],
                    fuzziness: "AUTO",
                  },
                },
                // Substring match on the raw address (e.g. "acme" -> "bob@acme.com").
                { wildcard: { recipient: { value: `*${q.toLowerCase()}*` } } },
              ],
            },
          }
        : { match_all: {} },
    },
  };
  const res = await es.search({
    index: config.elasticsearch.index,
    from,
    size,
    query,
    sort: [{ scheduledAt: { order: "desc" } }] as never,
  });

  const total = typeof res.hits.total === "number" ? res.hits.total : res.hits.total?.value ?? 0;
  const hits = res.hits.hits
    .filter((h) => h._source)
    .map((h) => ({
      ...(h._source as EmailDocument),
      score: h._score ?? undefined,
    }));

  return { total, hits };
}

/** Reconcile: (re)index any DB rows missing from Elasticsearch (e.g. after a fresh cluster). */
export async function reindexFromDb(): Promise<number> {
  await ensureIndex();
  const repo = AppDataSource.getRepository(EmailJob);
  const jobs = await repo.find({ take: 10000, order: { createdAt: "DESC" } });
  let count = 0;
  for (const job of jobs) {
    await indexEmailJob(job);
    count++;
  }
  logInfo("elasticsearch", `reindexed ${count} jobs`);
  return count;
}