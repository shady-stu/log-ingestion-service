import { findAggregates } from "../repositories/logs-aggregate.repository";
import {
  type AggregateBucketResult,
  type LogsAggregateQuery,
  type LogsAggregateResponse,
} from "../types";

export type FindAggregates = (
  query: LogsAggregateQuery
) => Promise<AggregateBucketResult[]>;

const CACHE_TTL_MS = 5000;
const CACHE_MAX_ENTRIES = 100;

type CacheEntry = {
  expiresAt: number;
  response: Promise<LogsAggregateResponse>;
};

export class LogsAggregateService {
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly find = findAggregates,
    private readonly now = Date.now
  ) {}

  async aggregate(query: LogsAggregateQuery): Promise<LogsAggregateResponse> {
    const key = JSON.stringify(query);
    const cached = this.cache.get(key);
    const now = this.now();

    if (cached && cached.expiresAt > now) {
      return cached.response;
    }

    this.cache.delete(key);
    const response = this.find(query).then((buckets) => ({ buckets }));
    const entry = { expiresAt: now + CACHE_TTL_MS, response };
    this.cache.set(key, entry);
    this.evictOldestEntry();

    try {
      return await response;
    } catch (error) {
      if (this.cache.get(key) === entry) {
        this.cache.delete(key);
      }

      throw error;
    }
  }

  private evictOldestEntry(): void {
    if (this.cache.size <= CACHE_MAX_ENTRIES) {
      return;
    }

    const oldestKey = this.cache.keys().next().value;

    if (oldestKey !== undefined) {
      this.cache.delete(oldestKey);
    }
  }
}
