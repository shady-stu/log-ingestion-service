import { type LogLevel, type StoredLog } from "./logs";

export type CursorData = {
  timestamp: string;
  id: string;
};

export type AttributeFilter = {
  key: string;
  value: string;
};

export type LogsQuery = {
  service?: string;
  level?: LogLevel;
  since?: string;
  until?: string;
  q?: string;
  limit: number;
  cursor?: CursorData;
  attributes: AttributeFilter[];
};

export type LogsPage = {
  logs: StoredLog[];
  next_cursor: string | null;
};
