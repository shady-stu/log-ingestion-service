import { findAggregates } from "../repositories/logs-aggregate.repository";
import {
  type AggregateBucketResult,
  type LogsAggregateQuery,
  type LogsAggregateResponse,
} from "../types";

export type FindAggregates = (
  query: LogsAggregateQuery
) => Promise<AggregateBucketResult[]>;

export class LogsAggregateService {
  constructor(private readonly find = findAggregates) {}

  async aggregate(query: LogsAggregateQuery): Promise<LogsAggregateResponse> {
    return { buckets: await this.find(query) };
  }
}
