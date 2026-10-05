import { Client } from "@elastic/elasticsearch";
import { config } from "../config";
import { AppDataSource } from "../db/typeorm";
import { EmailJob } from "../db/entities/EmailJob";
import { logError, logInfo, logWarn } from "../utils/logger";

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
      noteEsResult(true);
    }
    indexReady = true;
  } catch (err) {
    logError("elasticsearch", "ensureIndex failed (will retry on next call)", err);
    noteEsResult(false);
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

/**
 * Whether the cluster answered on the last probe. Search falls back to the
 * database when this is false so a dead/unprovisioned cluster degrades search
 * instead of breaking it.
 */
let esReachable: boolean | null = null;

export function isSearchDegraded(): boolean {
  return esReachable === false;
}

/** Mark the cluster up/down based on the outcome of a call. */
function noteEsResult(ok: boolean): void {
  if (esReachable === ok) return;
  esReachable = ok;
  if (ok) logInfo("elasticsearch", "cluster reachable; using Elasticsearch for search");
  else logWarn("elasticsearch", "cluster unreachable; falling back to database search");
}

/**
 * Substring search straight against the DB. Postgres and MySQL both support
 * ILIKE / LIKE, so this is driver-agnostic. Slightly less clever than the
 * Elasticsearch fuzzy match, but it keeps search working with no extra service.
 */
async function searchViaDb(q: string, from: number, size: number): Promise<SearchResult> {
  const repo = AppDataSource.getRepository(EmailJob);
  const term = `%${q}%`;

  const base = repo
    .createQueryBuilder("job")
    .where("job.recipient LIKE :term", { term })
    .orWhere("job.subject LIKE :term", { term })
    .orWhere("job.body LIKE :term", { term });

  const [rows, total] = await base
    .orderBy("job.scheduledAt", "DESC")
    .skip(from)
    .take(size)
    .getManyAndCount();

  return {
    total,
    hits: rows.map((job) => ({
      jobId: job.id,
      batchId: job.batchId,
      userId: job.userId,
      senderId: job.senderId,
      recipient: job.recipient,
      subject: job.subject,
      body: job.body,
      status: job.status,
      scheduledAt: job.scheduledAt instanceof Date ? job.scheduledAt.toISOString() : String(job.scheduledAt),
      sentAt: job.sentAt instanceof Date ? job.sentAt.toISOString() : job.sentAt ?? null,
      providerMessageId: job.providerMessageId,
    })),
  };
}

export async function searchEmails(q: string, from = 0, size = 50): Promise<SearchResult> {
  // A known-dead cluster skips the 5s timeout on every keystroke.
  if (esReachable !== false) {
    try {
      const result = await searchEmailsWithEs(q, from, size);
      noteEsResult(true);
      return result;
    } catch (err) {
      noteEsResult(false);
      logWarn("elasticsearch", "search failed; using database fallback", err);
    }
  }
  return searchViaDb(q, from, size);
}

async function searchEmailsWithEs(q: string, from: number, size: number): Promise<SearchResult> {
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