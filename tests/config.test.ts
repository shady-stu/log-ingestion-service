import { loadRuntimeConfig } from "../src/config/runtime-config";

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

  it("uses the internal PostgreSQL default without DATABASE_URL", () => {
    const config = loadRuntimeConfig({});

    expect(config.databaseUrl).toBe(databaseUrl);
  });

  it("uses the internal PostgreSQL default for an empty development value", () => {
    const config = loadRuntimeConfig({ DATABASE_URL: "" });

    expect(config.databaseUrl).toBe(databaseUrl);
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

  it("accepts valid PostgreSQL URLs outside the Compose network", () => {
    const config = loadRuntimeConfig({
      DATABASE_URL: "postgres://app_user:secret@localhost:5432/app_db",
      NODE_ENV: "production",
      AUTH_ENABLED: "true",
      LOADGEN_API_KEY: "loadgen-secret",
    });

    expect(config.databaseUrl).toBe(
      "postgres://app_user:secret@localhost:5432/app_db"
    );
  });

  it("does not read the removed PG_POOL_MAX setting", () => {
    expect(() => loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      PG_POOL_MAX: "not-a-number",
    })).not.toThrow();
  });

  it.each([
    ["RETENTION_DAYS", "0"],
    ["RETENTION_DAYS", "-1"],
    ["RETENTION_DAYS", "NaN"],
    ["RETENTION_DAYS", "1.5"],
    ["PORT", "0"],
    ["PORT", "65536"],
    ["PORT", "abc"],
    ["INSERT_BATCH_SIZE", "5001"],
    ["COPY_SERIALIZE_CHUNK_SIZE", "0"],
    ["AUTH_ENABLED", "yes"],
  ])("rejects invalid %s=%s", (name, value) => {
    expect(() => loadRuntimeConfig({ DATABASE_URL: databaseUrl, [name]: value }))
      .toThrow();
  });

  it("allows authentication without a seeded load-generator key", () => {
    expect(loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      AUTH_ENABLED: "true",
    })).toMatchObject({
      authEnabled: true,
      loadgenApiKey: undefined,
    });
  });

  it("requires production database configuration", () => {
    expect(() => loadRuntimeConfig({ NODE_ENV: "production" }))
      .toThrow("DATABASE_URL is required in production");
  });

  it("allows authentication to remain disabled in production", () => {
    expect(loadRuntimeConfig({
      DATABASE_URL: databaseUrl,
      NODE_ENV: "production",
      AUTH_ENABLED: "false",
    })).toMatchObject({
      nodeEnv: "production",
      authEnabled: false,
    });
  });

  it.each([
    "not-a-url",
    "http://localhost:5432/app_db",
  ])("rejects an invalid database URL: %s", (value) => {
    expect(() => loadRuntimeConfig({ DATABASE_URL: value })).toThrow();
  });
});
