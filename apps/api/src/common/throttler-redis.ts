import { Logger } from "@nestjs/common";
import { ThrottlerStorageRedisService } from "@nest-lab/throttler-storage-redis";
import Redis from "ioredis";

const logger = new Logger("ThrottlerStorage");

type StorageRecord = {
  totalHits: number;
  timeToExpire: number;
  isBlocked: boolean;
  timeToBlockExpire: number;
};

// Wraps the Redis-backed throttler storage and fails OPEN: if the store is
// unreachable, a request is allowed through rather than 500-ing the whole API.
// Rate limiting is a protection, not a hard dependency on Redis availability.
class ResilientThrottlerStorage {
  private outage = false;

  constructor(private readonly inner: { increment: (...args: any[]) => Promise<StorageRecord> }) {}

  async increment(key: string, ttl: number, limit: number, blockDuration: number, throttlerName: string): Promise<StorageRecord> {
    try {
      const record = await this.inner.increment(key, ttl, limit, blockDuration, throttlerName);
      if (this.outage) {
        logger.log("Throttler store recovered");
        this.outage = false;
      }
      return record;
    } catch (error) {
      if (!this.outage) {
        logger.warn(`Throttler store unavailable, failing open: ${error instanceof Error ? error.message : String(error)}`);
        this.outage = true;
      }
      return { totalHits: 0, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 };
    }
  }
}

// Shared Redis storage so rate limits are enforced across all API instances.
// Without REDIS_URL the throttler falls back to the default in-memory storage
// (correct for a single process).
export function createThrottlerStorage(): any {
  const url = process.env.REDIS_URL || process.env.REDIS_HOST_URL;
  if (!url) {
    logger.log("Throttler using in-memory storage (no REDIS_URL)");
    return undefined;
  }
  const client = new Redis(url, {
    maxRetriesPerRequest: 1,
    enableOfflineQueue: false,
    lazyConnect: false
  });
  // Prevent unhandled 'error' events from crashing the process; the wrapper
  // turns command failures into fail-open behaviour.
  client.on("error", () => undefined);
  logger.log("Throttler using shared Redis storage");
  return new ResilientThrottlerStorage(new ThrottlerStorageRedisService(client));
}
