import { findLogs } from "../repositories/logs-query.repository";
import { type LogsPage, type LogsQuery, type StoredLog } from "../types";
import { encodeCursor } from "./logs-query";

export type FindLogs = (query: LogsQuery) => Promise<StoredLog[]>;

export class LogsQueryService {
  constructor(private readonly find = findLogs) {}

  async query(query: LogsQuery): Promise<LogsPage> {
    const rows = await this.find(query);
    return createLogsPage(rows, query.limit);
  }
}

export function createLogsPage(rows: StoredLog[], limit: number): LogsPage {
  const hasNextPage = rows.length > limit;
  const logs = hasNextPage ? rows.slice(0, limit) : rows;
  const lastLog = logs.at(-1);

  return {
    logs,
    next_cursor: hasNextPage && lastLog
      ? encodeCursor({ timestamp: lastLog.timestamp, id: lastLog.id })
      : null,
  };
}
