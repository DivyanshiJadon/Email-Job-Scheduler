import Redis from "ioredis";
import { config } from "../config";

const noRetry = {
  retryStrategy(_times: number): number | null {
    return null;
  },
};

export function createRedisClient(): Redis {
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...noRetry,
  });
}

/**
 * Dedicated connection for the rate-limiter counters. Used outside of
 * BullMQ's job lifecycle so commands are never aborted when a Job is moved.
 */
export function createCounterClient(): Redis {
  return new Redis(config.redis.url, {
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
  });
}