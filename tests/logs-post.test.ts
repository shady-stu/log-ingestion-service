import Fastify from "fastify";
import { createPostLogsHandler } from "../src/api/handlers/logs.handler";
import { LogsService } from "../src/services/ingestion.service";
import { validateLog } from "../src/services/log-validator";
import { type Log } from "../src/types";
import {describe, expect, it, jest} from '@jest/globals';
describe("POST /logs HTTP behavior", () => {
  it("accepts and persists a valid batch", async () => {
    const persist = jest.fn(async (logs: Log[]) => logs.length);
    const app = createApp(new LogsService(persist));
    const logs = [createLog("first"), createLog("second")];

    const response = await app.inject({ method: "POST", url: "/logs", payload: { logs } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ accepted: 2, rejected: [] });
    expect(persist).toHaveBeenCalledWith(logs);
    await app.close();
  });

  it("partially accepts mixed input and preserves original rejection indexes", async () => {
    const persist = jest.fn(async (logs: Log[]) => logs.length);
    const app = createApp(new LogsService(persist));
    const logs = [
      createLog("first"),
      { ...createLog("bad-level"), level: "critical" },
      createLog("third"),
      { ...createLog("bad-message"), message: "" },
    ];

    const response = await app.inject({ method: "POST", url: "/logs", payload: { logs } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      accepted: 2,
      rejected: [
        { index: 1, reason: "invalid level: 'critical'" },
        { index: 3, reason: "message must be a non-empty string" },
      ],
    });
    expect(persist.mock.calls[0][0].map((log) => log.message)).toEqual([
      "first",
      "third",
    ]);
    await app.close();
  });

  it("returns 400 and persists nothing when every log is invalid", async () => {
    const persist = jest.fn(async (logs: Log[]) => logs.length);
    const app = createApp(new LogsService(persist));

    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: { logs: [{}, { ...createLog("bad"), service: "" }] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().accepted).toBe(0);
    expect(response.json().rejected).toHaveLength(2);
    expect(persist).not.toHaveBeenCalled();
    await app.close();
  });

  it.each([
    {},
    { logs: "wrong" },
    { logs: null },
    { logs: [] },
  ])("rejects malformed envelopes %#", async (payload) => {
    const app = createApp(new LogsService(async () => 0));
    const response = await app.inject({ method: "POST", url: "/logs", payload });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "Invalid request body" });
    await app.close();
  });

  it("rejects malformed JSON", async () => {
    const app = createApp(new LogsService(async () => 0));
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      headers: { "content-type": "application/json" },
      payload: '{"logs":',
    });

    expect(response.statusCode).toBe(400);
    await app.close();
  });

  it("does not acknowledge logs when persistence fails", async () => {
    const app = createApp(new LogsService(async () => {
      throw new Error("COPY failed");
    }));

    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: { logs: [createLog("not-persisted")] },
    });

    expect(response.statusCode).toBe(500);
    expect(response.json()).not.toHaveProperty("accepted");
    await app.close();
  });

  it("returns 413 when the configured Fastify body limit is exceeded", async () => {
    const app = createApp(new LogsService(async () => 0), 100);
    const response = await app.inject({
      method: "POST",
      url: "/logs",
      payload: { logs: [createLog("a message larger than the test body limit")] },
    });

    expect(response.statusCode).toBe(413);
    await app.close();
  });
});

describe("POST log validation", () => {
  const now = Date.parse("2026-08-12T12:00:00.000Z");
  const validAtNow = (message: string) => ({
    ...createLog(message),
    timestamp: new Date(now).toISOString(),
  });

  it.each(["debug", "info", "warn", "error"])("accepts level %s", (level) => {
    expect(validateLog({ ...validAtNow("valid"), level }, now)).not.toEqual(expect.any(String));
  });

  it.each([
    ["invalid timestamp", { timestamp: "not-a-date" }],
    ["future timestamp", { timestamp: "2026-08-12T12:05:00.001Z" }],
    ["invalid level", { level: "critical" }],
    ["empty service", { service: "" }],
    ["empty message", { message: "" }],
    ["array attributes", { attributes: [] }],
    ["nested attributes", { attributes: { nested: {} } }],
    ["null attributes", { attributes: null }],
  ])("rejects %s", (_name, override) => {
    expect(typeof validateLog({ ...validAtNow("invalid"), ...override }, now)).toBe("string");
  });

  it("accepts historical and exact five-minute-boundary timestamps", () => {
    expect(validateLog({ ...createLog("old"), timestamp: "2020-01-01T00:00:00.000Z" }, now))
      .not.toEqual(expect.any(String));
    expect(validateLog({ ...createLog("boundary"), timestamp: "2026-08-12T12:05:00.000Z" }, now))
      .not.toEqual(expect.any(String));
  });

  it("accepts flat string, number, and boolean attributes", () => {
    const result = validateLog({
      ...validAtNow("attributes"),
      attributes: { region: "eu-west", retries: 2, success: true },
    }, now);

    expect(result).toMatchObject({
      attributes: { region: "eu-west", retries: 2, success: true },
    });
  });
});

function createApp(service: LogsService, bodyLimit = 1024 * 1024) {
  const app = Fastify({ bodyLimit });
  app.post("/logs", createPostLogsHandler(service));
  return app;
}

function createLog(message: string): Log {
  return {
    timestamp: new Date().toISOString(),
    level: "info",
    service: "test",
    message,
    attributes: {},
  };
}
