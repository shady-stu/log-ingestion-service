import { loadRuntimeConfig } from "../src/config";

const databaseUrl = "postgresql://logs_user:logs_password@postgres:5432/logs_db";
import {describe, expect, it, jest} from '@jest/globals';
describe("runtime configuration", () => {
  it("loads typed defaults from one source", () => {
    const config = loadRuntimeConfig({ DATABASE_URL: databaseUrl });

    expect(config).toMatchObject({
      nodeEnv: "development",
      logLevel: "info",
      port: 8080,
      bodyLimitBytes: 10 * 1024 * 1024,
      pgPoolMax: 5,
      readPoolMax: 4,
      pgConnectionTimeoutMs: 5000,
      pgIdleTimeoutMs: 30000,
      insertBatchSize: 1000,
      copySerializeChunkSize: 2000,
      retentionDays: 30,
      logsPurgeToken: undefined,
      authEnabled: false,
      loadgenApiKey: undefined,
    });
  });

  it("parses valid runtime overrides", () => {
    const config = loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      LOG_LEVEL: "warn",
      PORT: "9090",
      RETENTION_DAYS: "14",
      BODY_LIMIT_BYTES: "2048",
      PG_IDLE_TIMEOUT_MS: "0",
      LOGS_PURGE_TOKEN: "secret",
      AUTH_ENABLED: "true",
      LOADGEN_API_KEY: "loadgen-secret",
    });

    expect(config).toMatchObject({
      nodeEnv: "production",
      logLevel: "warn",
      port: 9090,
      retentionDays: 14,
      bodyLimitBytes: 2048,
      pgIdleTimeoutMs: 0,
      logsPurgeToken: "secret",
      authEnabled: true,
      loadgenApiKey: "loadgen-secret",
    });
  });

  it.each([
    ["RETENTION_DAYS", "0"],
    ["RETENTION_DAYS", "-1"],
    ["RETENTION_DAYS", "NaN"],
    ["RETENTION_DAYS", "1.5"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "abc"],
    ["PG_POOL_MAX", "4"],
    ["PG_POOL_MAX", "6"],
    ["INSERT_BATCH_SIZE", "5001"],
    ["COPY_SERIALIZE_CHUNK_SIZE", "0"],
    ["AUTH_ENABLED", "yes"],
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() => loadRuntimeConfig({ DATABASE_URL: databaseUrl, [name]: value }))
      .toThrow();
  });

  it("requires the load-generator key when authentication is enabled", () => {
    expect(() => loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      AUTH_ENABLED: "true",
    })).toThrow("LOADGEN_API_KEY must be set");
  });

  it.each([
    undefined,
    "not-a-url",
    "postgresql://logs_user:logs_password@localhost:5432/logs_db",
    "postgresql://logs_user:logs_password@postgres:5432/other_db",
  ])("rejects a non-internal database URL: %s", (value) => {
    expect(() => loadRuntimeConfig({ DATABASE_URL: value })).toThrow();
  });
});
