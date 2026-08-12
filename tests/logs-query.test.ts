import { buildLogsQuery } from "../src/repositories/logs-query.repository";
import Fastify from "fastify";
import { createGetLogsHandler } from "../src/api/handlers/logs-query.handler";
import {
  decodeCursor,
  encodeCursor,
  InvalidLogsQueryError,
  parseLogsQuery,
} from "../src/services/logs-query";
import { createLogsPage, LogsQueryService } from "../src/services/logs-query.service";
import { type StoredLog } from "../src/types";
import {describe, expect, it, jest} from '@jest/globals';
const timestamp = "2026-07-20T14:32:01.123Z";

describe("GET /logs query parser", () => {
  it("parses all supported filters with their intended values", () => {
    const query = parseLogsQuery({
      service: "checkout",
      level: "error",
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      q: "declined",
      limit: "100",
      "attr.region": "eu-west",
      "attr.retries": "3",
      "attr.success": "true",
    });

    expect(query).toEqual({
      service: "checkout",
      level: "error",
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      q: "declined",
      limit: 100,
      cursor: undefined,
      attributes: [
        { key: "region", value: "eu-west" },
        { key: "retries", value: "3" },
        { key: "success", value: "true" },
      ],
    });
  });

  it.each([
    [{ limit: "0" }],
    [{ limit: "1001" }],
    [{ limit: "abc" }],
    [{ limit: "10.5" }],
    [{ level: "critical" }],
    [{ since: "not-a-timestamp" }],
    [{ until: "2026-02-30T00:00:00Z" }],
    [{ since: "2026-07-20T15:00:00Z", until: "2026-07-20T14:00:00Z" }],
    [{ cursor: "not_a_valid_cursor" }],
    [{ "attr.": "x" }],
  ])("rejects invalid query input %#", (query) => {
    expect(() => parseLogsQuery(query)).toThrow(InvalidLogsQueryError);
  });

  it("supports repeated attribute keys as AND filters", () => {
    const query = parseLogsQuery({ "attr.region": ["eu-west", "eu-central"] });

    expect(query.attributes).toEqual([
      { key: "region", value: "eu-west" },
      { key: "region", value: "eu-central" },
    ]);
  });
});

describe("opaque cursor", () => {
  it("round-trips a timestamp and bigint id", () => {
    const cursor = encodeCursor({ timestamp, id: "9007199254740993" });

    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor)).toEqual({
      timestamp,
      id: "9007199254740993",
    });
  });

  it("rejects unsupported cursor versions", () => {
    const cursor = Buffer.from(
      JSON.stringify({ v: 2, timestamp, id: "1" })
    ).toString("base64url");

    expect(() => decodeCursor(cursor)).toThrow("Invalid cursor");
  });
});

describe("parameterized keyset query", () => {
  it("uses the required ordering, keyset predicate, and limit plus one", () => {
    const query = parseLogsQuery({
      service: "checkout' OR 1=1 --",
      level: "error",
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
      q: "declined' OR 1=1 --",
      "attr.user_id": "42' OR 1=1 --",
      limit: "10",
      cursor: encodeCursor({ timestamp, id: "123" }),
    });
    const built = buildLogsQuery(query);

    expect(built.text).toContain('ORDER BY "timestamp" DESC, "id" DESC');
    expect(built.text).toContain('(\"timestamp\", \"id\") <');
    expect(built.text).toContain('"attributes" @> jsonb_build_object');
    expect(built.text).toContain('"attributes" ->> $6 = $7');
    expect(built.text).toContain('LIMIT $10::int');
    expect(built.text).not.toContain("OR 1=1");
    expect(built.values).toEqual([
      "checkout' OR 1=1 --",
      "error",
      "2026-07-20T14:00:00Z",
      "2026-07-20T15:00:00Z",
      "declined' OR 1=1 --",
      "user_id",
      "42' OR 1=1 --",
      timestamp,
      "123",
      11,
    ]);
  });

  it("uses inclusive since and exclusive until", () => {
    const built = buildLogsQuery(parseLogsQuery({
      since: "2026-07-20T14:00:00Z",
      until: "2026-07-20T15:00:00Z",
    }));

    expect(built.text).toContain('"timestamp" >= $1::timestamptz');
    expect(built.text).toContain('"timestamp" < $2::timestamptz');
  });

  it("parameterizes malicious attribute keys as well as values", () => {
    const maliciousKey = 'region" OR 1=1 --';
    const built = buildLogsQuery(parseLogsQuery({
      [`attr.${maliciousKey}`]: "eu-west' OR 1=1 --",
    }));

    expect(built.text).not.toContain(maliciousKey);
    expect(built.text).not.toContain("eu-west' OR 1=1");
    expect(built.values).toEqual([maliciousKey, "eu-west' OR 1=1 --", 101]);
  });
});

describe("response pagination", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: String(25 - index),
    timestamp,
    level: "info" as const,
    service: "checkout",
    message: "payment declined",
    attributes: { retries: 3, success: true },
  }));

  it("returns a cursor only when the limit plus one row is present", () => {
    const firstPage = createLogsPage(rows.slice(0, 11), 10);
    const lastPage = createLogsPage(rows.slice(20), 10);

    expect(firstPage.logs).toHaveLength(10);
    expect(decodeCursor(firstPage.next_cursor as string)).toEqual({
      timestamp,
      id: "16",
    });
    expect(firstPage.logs[0].attributes).toEqual({ retries: 3, success: true });
    expect(lastPage.logs).toHaveLength(5);
    expect(lastPage.next_cursor).toBeNull();
  });
});

describe("GET /logs HTTP behavior", () => {
  const rows = Array.from({ length: 25 }, (_, index) => ({
    id: String(25 - index),
    timestamp,
    level: "info" as const,
    service: "checkout",
    message: "payment declined",
    attributes: { retries: 3, success: true },
  }));

  it("returns deterministic pages without duplicates when newer rows arrive", async () => {
    const storedRows = [...rows];
    const service = new LogsQueryService(async (query) => {
      const eligible = query.cursor
        ? storedRows.filter((row) => BigInt(row.id) < BigInt(query.cursor!.id))
        : storedRows;

      return eligible.slice(0, query.limit + 1);
    });
    const app = Fastify();
    app.get("/logs", createGetLogsHandler(service));

    const firstResponse = await app.inject("/logs?limit=10");
    const firstPage = firstResponse.json() as { logs: StoredLog[]; next_cursor: string };
    storedRows.unshift({
      ...rows[0],
      id: "26",
      timestamp: "2026-07-20T15:00:00.000Z",
      message: "newer row",
    });
    const secondResponse = await app.inject(
      `/logs?limit=10&cursor=${encodeURIComponent(firstPage.next_cursor)}`
    );
    const secondPage = secondResponse.json() as { logs: StoredLog[]; next_cursor: string | null };
    const ids = [...firstPage.logs, ...secondPage.logs].map((log) => log.id);

    expect(firstResponse.statusCode).toBe(200);
    expect(secondResponse.statusCode).toBe(200);
    expect(firstPage.logs).toHaveLength(10);
    expect(secondPage.logs).toHaveLength(10);
    expect(new Set(ids).size).toBe(20);
    expect(secondPage.logs.some((log) => log.id === "26")).toBe(false);
    expect(firstPage.logs[0].attributes).toEqual({ retries: 3, success: true });

    await app.close();
  });

  it("returns 400 for malformed cursor rather than 500", async () => {
    const app = Fastify();
    app.get("/logs", createGetLogsHandler(new LogsQueryService(async () => [])));

    const response = await app.inject("/logs?cursor=bad");

    expect(response.statusCode).toBe(400);
    expect(response.json().message).toBe("Invalid cursor");

    await app.close();
  });
});
