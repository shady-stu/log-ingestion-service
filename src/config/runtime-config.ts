import "dotenv/config";
import {
  LOG_LEVELS,
  MAX_BATCH_SIZE,
  NODE_ENV_VALUES,
  type LogLevel,
  type NodeEnvironment,
} from "./constants";
import {
  parseBoolean,
  parseDatabaseUrl,
  parseEnum,
  parseInteger,
} from "./parsers";

export type { LogLevel, NodeEnvironment } from "./constants";

export type RuntimeConfig = {
  nodeEnv: NodeEnvironment;
  logLevel: LogLevel;
  port: number;
  bodyLimitBytes: number;
  databaseUrl: string;
  pgConnectionTimeoutMs: number;
  pgIdleTimeoutMs: number;
  insertBatchSize: number;
  copySerializeChunkSize: number;
  retentionDays: number;
  logsPurgeToken?: string;
  authEnabled: boolean;
  loadgenApiKey?: string;
};

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const nodeEnv = parseEnum(
    env.NODE_ENV,
    "NODE_ENV",
    "development",
    NODE_ENV_VALUES
  );
  const databaseUrl = parseDatabaseUrl(env.DATABASE_URL, nodeEnv);
  const authEnabled = parseBoolean(env.AUTH_ENABLED, "AUTH_ENABLED", false);
  const loadgenApiKey = env.LOADGEN_API_KEY || undefined;

  return {
    nodeEnv,
    logLevel: parseEnum(env.LOG_LEVEL, "LOG_LEVEL", "info", LOG_LEVELS),
    port: parseInteger(env.PORT, "PORT", 8080, 1, 65535),
    bodyLimitBytes: parseInteger(
      env.BODY_LIMIT_BYTES,
      "BODY_LIMIT_BYTES",
      10 * 1024 * 1024,
      1
    ),
    databaseUrl,
    pgConnectionTimeoutMs: parseInteger(
      env.PG_CONNECTION_TIMEOUT_MS,
      "PG_CONNECTION_TIMEOUT_MS",
      5000,
      1
    ),
    pgIdleTimeoutMs: parseInteger(
      env.PG_IDLE_TIMEOUT_MS,
      "PG_IDLE_TIMEOUT_MS",
      30000,
      0
    ),
    insertBatchSize: parseInteger(
      env.INSERT_BATCH_SIZE,
      "INSERT_BATCH_SIZE",
      1000,
      1,
      MAX_BATCH_SIZE
    ),
    copySerializeChunkSize: parseInteger(
      env.COPY_SERIALIZE_CHUNK_SIZE,
      "COPY_SERIALIZE_CHUNK_SIZE",
      2000,
      1,
      MAX_BATCH_SIZE
    ),
    retentionDays: parseInteger(env.RETENTION_DAYS, "RETENTION_DAYS", 30, 1),
    logsPurgeToken: env.LOGS_PURGE_TOKEN || undefined,
    authEnabled,
    loadgenApiKey,
  };
}

export const runtimeConfig = loadRuntimeConfig();
