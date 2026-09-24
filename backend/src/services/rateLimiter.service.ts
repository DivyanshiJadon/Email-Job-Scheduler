import { createCounterClient } from "../queue/redis";
import { config } from "../config";
import { logError } from "../utils/logger";

/**
 * Redis-backed, multi-instance-safe rate limiter.
 *
 * Counters are keyed by `hour window + scope` so they survive worker
 * restarts and are correct across multiple processes / instances.
 *
 *  - per-sender : rl:s:{senderId}:{YYYYMMDDHH}
 *  - global     : rl:g:{YYYYMMDDHH}
 *
 * The check-and-reserve is a single atomic Lua script so concurrent workers
 * can never blow past the limiter window by more than a few stragglers.
 */

const PAGE_LIMITER_TTL_SECONDS = 3600; // 1h extra so the window never expires early

const CHECK_AND_RESERVE = `
local senderKey = KEYS[1]
local globalKey = KEYS[2]
local senderLimit = tonumber(ARGV[1])
local globalLimit = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])

local s = redis.call('GET', senderKey) or '0'
local g = redis.call('GET', globalKey) or '0'
if tonumber(s) >= senderLimit or tonumber(g) >= globalLimit then
  return {0, tonumber(s), tonumber(g)}
end
local sn = redis.call('INCR', senderKey)
local gn = redis.call('INCR', globalKey)
redis.call('EXPIRE', senderKey, ttl)
redis.call('EXPIRE', globalKey, ttl)
return {1, sn, gn}
`;

let client: ReturnType<typeof createCounterClient> | null = null;

function getClient() {
  if (!client) client = createCounterClient();
  return client;
}

export function hourKey(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  return `${y}${m}${day}${h}`;
}

/** Seconds remaining until the next UTC hour window begins. */
export function secondsUntilNextWindow(): number {
  const now = Date.now();
  const next = new Date(Math.ceil(now / 3600000) * 3600000);
  return Math.max(0, Math.floor((next.getTime() - now) / 1000));
}

export function senderKey(senderId: string): string {
  return `rl:s:${senderId}:${hourKey()}`;
}

export function globalKey(): string {
  return `rl:g:${hourKey()}`;
}

export interface ReserveResult {
  /** true if a slot was reserved inside the current window. */
  allowed: boolean;
  senderCount: number;
  globalCount: number;
}

/**
 * Atomically checks both limits and reserves a send slot.
 * Returns allowed=false when either limit is exhausted for this hour.
 *
 * senderHourlyLimit may be a per-sender override (from the Sender row); when
 * omitted the global per-sender env cap is used.
 */
export async function reserveSendSlot(senderId: string, senderHourlyLimit?: number): Promise<ReserveResult> {
  const c = getClient();
  const senderLimit = senderHourlyLimit ?? config.scheduler.maxEmailsPerHourPerSender;
  try {
    const script = CHECK_AND_RESERVE;
    const res = (await c.eval(script, 2, senderKey(senderId), globalKey(), String(senderLimit), String(config.scheduler.maxEmailsPerHour), String(PAGE_LIMITER_TTL_SECONDS))) as [number, number, number];
    return { allowed: res[0] === 1, senderCount: res[1], globalCount: res[2] };
  } catch (err) {
    // Fail-open: connection issues must not silently drop scheduled emails.
    logError("rateLimiter", "reserveSendSlot failed (fail-open)", err);
    return { allowed: true, senderCount: 0, globalCount: 0 };
  }
}

/**
 * Distributed "minimum delay between emails" gate.
 * Attempts to claim a per-sender slot that lives for minDelayBetweenEmailsMs.
 * If already claimed, returns the remaining ms to wait before trying again.
 */
export async function acquireSendGap(senderId: string): Promise<number> {
  const c = getClient();
  const key = `gap:${senderId}`;
  const delayMs = config.scheduler.minDelayBetweenEmailsMs;
  try {
    const ok = await c.set(key, String(Date.now()), "PX", delayMs, "NX");
    if (ok === "OK") return 0;
    const ttl = await c.pttl(key);
    return Math.max(0, Number.isFinite(ttl) ? ttl : delayMs);
  } catch (err) {
    logError("rateLimiter", "acquireSendGap failed (fail-open)", err);
    return 0;
  }
}

export function getCurrentCounters(senderId: string): Promise<[number, number]> {
  const c = getClient();
  return Promise.all([
    c.get(senderKey(senderId)).then((v) => parseInt(v ?? "0", 10)),
    c.get(globalKey()).then((v) => parseInt(v ?? "0", 10)),
  ]);
}

/**
 * A one-shot "bell" per sender per hour window — emails are deferred one by
 * one when the limit is hit, but Slack is notified exactly once per window.
 */
export async function ringRateLimitBell(senderId: string): Promise<boolean> {
  const c = getClient();
  const key = `slackBell:${senderId}:${hourKey()}`;
  try {
    const ok = await c.set(key, "1", "EX", 3600, "NX");
    return ok === "OK";
  } catch (err) {
    logError("rateLimiter", "ringRateLimitBell failed (fail-open)", err);
    return false;
  }
}

export async function closeCounterClient(): Promise<void> {
  if (client) {
    await client.quit();
    client = null;
  }
}