import {
  type AttributeFilter,
  type LogLevel,
} from "./index";

export type AggregateBucket = "1m" | "5m" | "1h" | "1d";
export type AggregateGroupBy = "service" | "level";

export type LogsAggregateQuery = {
  since: string;
  until: string;
  bucket: AggregateBucket;
  groupBy?: AggregateGroupBy;
  service?: string;
  level?: LogLevel;
  q?: string;
  attributes: AttributeFilter[];
};

export type AggregateBucketResult = {
  start: string;
  group: string | null;
  count: number;
};

export type LogsAggregateResponse = {
  buckets: AggregateBucketResult[];
};
