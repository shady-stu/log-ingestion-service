export const MAX_BATCH_SIZE = 5000;

export const LOG_LEVELS = [
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const;

export const NODE_ENV_VALUES = ["development", "test", "production"] as const;

export const DEFAULT_DATABASE_URL =
  "postgresql://logs_user:logs_password@postgres:5432/logs_db";

export type NodeEnvironment = (typeof NODE_ENV_VALUES)[number];
export type LogLevel = (typeof LOG_LEVELS)[number];
