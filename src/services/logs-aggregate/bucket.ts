import { type AggregateBucket } from "../../types";

const BUCKET_INTERVALS: Record<AggregateBucket, string> = {
  "1m": "1 minute",
  "5m": "5 minutes",
  "1h": "1 hour",
  "1d": "1 day",
};

export function parseAggregateBucket(value: string): AggregateBucket | null {
  return Object.hasOwn(BUCKET_INTERVALS, value)
    ? value as AggregateBucket
    : null;
}

export function resolveBucketInterval(bucket: AggregateBucket): string {
  return BUCKET_INTERVALS[bucket];
}
