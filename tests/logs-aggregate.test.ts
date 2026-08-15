import Fastify from "fastify";
import { createGetLogsAggregateHandler } from "../src/api/handlers/logs-aggregate.handler";
import { buildAggregateQuery } from "../src/repositories/logs-aggregate.repository";
import { parseAggregateQuery } from "../src/services/logs-aggregate/parser";
import { LogsAggregateService } from "../src/services/logs-aggregate.service";
import { InvalidLogsQueryError } from "../src/services/logs-query";
import {describe, expect, it, jest} from '@jest/globals';
const since = "2026-08-11T12:00:00.000Z";
const until = "2026-08-11T13:00:00.000Z";

describe("GET /logs/aggregate parser", () => {
  it("parses required parameters, grouping, and shared filters", () => {
    expect(parseAggregateQuery({
      since,
      until,
      bucket: "5m",
      group_by: "service",
      service: "checkout",
      level: "error",
      q: "declined",
      "attr.region": "eu-west",
      "attr.retries": "3",
    })).toEqual({
      since,
      until,
      bucket: "5m",
      groupBy: "service",
      service: "checkout",
      level: "error",
      q: "declined",
      attributes: [
        { key: "region", value: "eu-west" },
        { key: "retries", value: "3" },
      ],
    });
  });

  it.each([
    [{}],
    [{ since, until, bucket: "2m" }],
    [{ since, until, bucket: "1m", group_by: "message" }],
    [{ since, until, bucket: "1m", level: "critical" }],
    [{ since: "not-a-date", until, bucket: "1m" }],
    [{ since, until: "not-a-date", bucket: "1m" }],
    [{ since, until: since, bucket: "1m" }],
    [{ since: until, until: since, bucket: "1m" }],
    [{ since, until, bucket: "1m", "attr.": "x" }],
    [{ since, until, bucket: "1m", limit: "100" }],
  ])("rejects invalid aggregate query %#", (query) => {
    expect(() => parseAggregateQuery(query)).toThrow(InvalidLogsQueryError);
  });
});

describe("aggregate SQL", () => {
  it("uses a parameterized date_bin query without grouping", () => {
    const built = buildAggregateQuery(parseAggregateQuery({
      since,
      until,
      bucket: "1m",
    }));

    expect(built.text).toContain("date_bin($1::interval");
    expect(built.text).toContain('WITH "aggregates" AS MATERIALIZED');
    expect(built.text).toContain("NULL::text AS \"group\"");
    expect(built.text).toContain("GROUP BY \"start\"");
    expect(built.text).toContain("ORDER BY \"start\" ASC");
    expect(built.values).toEqual(["1 minute", since, until]);
  });

  it.each([
    ["5m", "5 minutes"],
    ["1h", "1 hour"],
    ["1d", "1 day"],
  ])("maps bucket %s to the approved interval", (bucket, interval) => {
    const built = buildAggregateQuery(parseAggregateQuery({ since, until, bucket }));

    expect(built.values[0]).toBe(interval);
  });

  it.each(["service", "level"])('groups safely by allowed field "%s"', (groupBy) => {
    const built = buildAggregateQuery(parseAggregateQuery({
      since,
      until,
      bucket: "1h",
      group_by: groupBy,
    }));

    expect(built.text).toContain(`\"${groupBy}\" AS \"group\"`);
    expect(built.text).toContain(`GROUP BY \"start\", \"${groupBy}\"`);
    expect(built.text).toContain(`ORDER BY \"start\" ASC, \"${groupBy}\" ASC`);
  });

  it("keeps malicious filter values out of the SQL text", () => {
    const built = buildAggregateQuery(parseAggregateQuery({
      since,
      until,
      bucket: "1m",
      service: "checkout' OR 1=1 --",
      q: "declined' OR 1=1 --",
      "attr.user_id": "42' OR 1=1 --",
    }));

    expect(built.text).not.toContain("OR 1=1");
    expect(built.text).toContain("jsonb_build_object");
    expect(built.values).toEqual([
      "1 minute",
      since,
      until,
      "checkout' OR 1=1 --",
      "declined' OR 1=1 --",
      "user_id",
      "42' OR 1=1 --",
    ]);
  });
});

describe("GET /logs/aggregate HTTP behavior", () => {
  const deterministicBuckets = [
    { start: "2026-08-11T12:00:00.000Z", group: "checkout", count: 2 },
    { start: "2026-08-11T12:00:00.000Z", group: "billing", count: 1 },
    { start: "2026-08-11T12:05:00.000Z", group: "checkout", count: 1 },
  ];

  it("returns ordered bucket results from the aggregate service", async () => {
    const aggregateService = new LogsAggregateService(async (query) => {
      expect(query.bucket).toBe("5m");
      expect(query.groupBy).toBe("service");
      return deterministicBuckets;
    });
    const app = Fastify();
    app.get("/logs/aggregate", createGetLogsAggregateHandler(aggregateService));

    const response = await app.inject(
      `/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&bucket=5m&group_by=service`
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ buckets: deterministicBuckets });
    await app.close();
  });

  it("returns an empty bucket list for a valid query with no matches", async () => {
    const app = Fastify();
    app.get(
      "/logs/aggregate",
      createGetLogsAggregateHandler(new LogsAggregateService(async () => []))
    );

    const response = await app.inject(
      `/logs/aggregate?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&bucket=1d`
    );

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ buckets: [] });
    await app.close();
  });

  it("returns 400 instead of 500 for invalid aggregate input", async () => {
    const app = Fastify();
    app.get("/logs/aggregate", createGetLogsAggregateHandler());

    const response = await app.inject("/logs/aggregate?bucket=2m");

    expect(response.statusCode).toBe(400);
    await app.close();
  });
});

describe("aggregate result cache", () => {
  const query = parseAggregateQuery({ since, until, bucket: "1m" });

  it("reuses identical results for five seconds", async () => {
    let now = 1000;
    const find = jest.fn(async () => [
      { start: since, group: null, count: 1 },
    ]);
    const service = new LogsAggregateService(find, () => now);

    await service.aggregate(query);
    await service.aggregate(query);
    expect(find).toHaveBeenCalledTimes(1);

    now += 5001;
    await service.aggregate(query);
    expect(find).toHaveBeenCalledTimes(2);
  });

  it("does not cache failed queries", async () => {
    const find = jest.fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([]);
    const service = new LogsAggregateService(find);

    await expect(service.aggregate(query)).rejects.toThrow("database unavailable");
    await expect(service.aggregate(query)).resolves.toEqual({ buckets: [] });
    expect(find).toHaveBeenCalledTimes(2);
  });
});
