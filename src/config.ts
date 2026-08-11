import "dotenv/config";

const REQUIRED_TOTAL_CONNECTIONS = 5;
const MAX_BATCH_SIZE = 5000;
const LOG_LEVELS = new Set([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
  "silent",
] as const);

type NodeEnvironment = "development" | "test" | "production";
type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal" | "silent";

export type RuntimeConfig = {
  nodeEnv: NodeEnvironment;
  logLevel: LogLevel;
  port: number;
  bodyLimitBytes: number;
  databaseUrl: string;
  pgPoolMax: number;
  readPoolMax: number;
  pgConnectionTimeoutMs: number;
  pgIdleTimeoutMs: number;
  insertBatchSize: number;
  copySerializeChunkSize: number;
  retentionDays: number;
  logsPurgeToken?: string;
};

export function loadRuntimeConfig(
  env: NodeJS.ProcessEnv = process.env
): RuntimeConfig {
  const pgPoolMax = readInteger(env, "PG_POOL_MAX", REQUIRED_TOTAL_CONNECTIONS, 1);

  if (pgPoolMax !== REQUIRED_TOTAL_CONNECTIONS) {
    throw new Error("PG_POOL_MAX must remain exactly 5");
  }

  return {
    nodeEnv: readNodeEnvironment(env.NODE_ENV),
    logLevel: readLogLevel(env.LOG_LEVEL),
    port: readInteger(env, "PORT", 8080, 1, 65535),
    bodyLimitBytes: readInteger(
      env,
      "BODY_LIMIT_BYTES",
      10 * 1024 * 1024,
      1
    ),
    databaseUrl: readInternalDatabaseUrl(env.DATABASE_URL),
    pgPoolMax,
    readPoolMax: pgPoolMax - 1,
    pgConnectionTimeoutMs: readInteger(
      env,
      "PG_CONNECTION_TIMEOUT_MS",
      5000,
      1
    ),
    pgIdleTimeoutMs: readInteger(env, "PG_IDLE_TIMEOUT_MS", 30000, 0),
    insertBatchSize: readInteger(
      env,
      "INSERT_BATCH_SIZE",
      1000,
      1,
      MAX_BATCH_SIZE
    ),
    copySerializeChunkSize: readInteger(
      env,
      "COPY_SERIALIZE_CHUNK_SIZE",
      2000,
      1,
      MAX_BATCH_SIZE
    ),
    retentionDays: readInteger(env, "RETENTION_DAYS", 30, 1),
    logsPurgeToken: readOptionalSecret(env.LOGS_PURGE_TOKEN),
  };
}

function readInteger(
  env: NodeJS.ProcessEnv,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  const rawValue = env[name];

  if (rawValue === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(rawValue)) {
    throw new Error(`${name} must be an integer`);
  }

  const value = Number(rawValue);

  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }

  return value;
}

function readNodeEnvironment(value: string | undefined): NodeEnvironment {
  const nodeEnv = value ?? "development";

  if (nodeEnv !== "development" && nodeEnv !== "test" && nodeEnv !== "production") {
    throw new Error("NODE_ENV must be development, test, or production");
  }

  return nodeEnv;
}

function readLogLevel(value: string | undefined): LogLevel {
  const logLevel = value ?? "info";

  if (!LOG_LEVELS.has(logLevel as LogLevel)) {
    throw new Error("LOG_LEVEL is invalid");
  }

  return logLevel as LogLevel;
}

function readInternalDatabaseUrl(value: string | undefined): string {
  if (!value) {
    throw new Error("DATABASE_URL is not set");
  }

  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (
    url.protocol !== "postgresql:" ||
    url.hostname !== "postgres" ||
    url.port !== "5432" ||
    url.pathname !== "/logs_db"
  ) {
    throw new Error(
      "DATABASE_URL must point to the internal postgres service and logs_db"
    );
  }

  return value;
}

function readOptionalSecret(value: string | undefined): string | undefined {
  return value && value.length > 0 ? value : undefined;
}

export const runtimeConfig = loadRuntimeConfig();
