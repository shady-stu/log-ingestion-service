import { readPool } from "../db/pool";
import {
  type AggregateBucketResult,
  type AggregateGroupBy,
  type LogsAggregateQuery,
} from "../types";
import { buildAttributeCondition } from "./logs-query.repository";
import { resolveBucketInterval } from "../services/logs-aggregate/bucket";

type DatabaseAggregateRow = {
  start: Date;
  group: string | null;
  count: string;
};

export async function findAggregates(
  query: LogsAggregateQuery
): Promise<AggregateBucketResult[]> {
  const builtQuery = buildAggregateQuery(query);
  const result = await readPool.query<DatabaseAggregateRow>(
    builtQuery.text,
    builtQuery.values
  );

  return result.rows.map(mapAggregateRow);
}

export function buildAggregateQuery(query: LogsAggregateQuery) {
  const queryConditions: string[] = [];
  const queryParameters: unknown[] = [];
  const parameter = (value: unknown) => {
    queryParameters.push(value);
    return `$${queryParameters.length}`;
  };
  const bucketInterval = parameter(resolveBucketInterval(query.bucket));
  const bucketStart = `date_bin(${bucketInterval}::interval, "timestamp", '1970-01-01'::timestamptz)`;
  const groupByColumn = resolveGroupByColumn(query.groupBy);

  queryConditions.push(`"timestamp" >= ${parameter(query.since)}::timestamptz`);
  queryConditions.push(`"timestamp" < ${parameter(query.until)}::timestamptz`);

  if (query.service !== undefined) {
    queryConditions.push(`"service" = ${parameter(query.service)}`);
  }

  if (query.level !== undefined) {
    queryConditions.push(`"level" = ${parameter(query.level)}`);
  }

  if (query.q !== undefined) {
    queryConditions.push(`"message" ILIKE '%' || ${parameter(query.q)} || '%'`);
  }

  for (const attribute of query.attributes) {
    const attributeKey = parameter(attribute.key);
    const attributeValue = parameter(attribute.value);

    queryConditions.push(
      buildAttributeCondition(attributeKey, attributeValue, attribute.value)
    );
  }

  const groupSelect = groupByColumn
    ? `${groupByColumn} AS "group"`
    : "NULL::text AS \"group\"";
  const groupBy = groupByColumn
    ? `GROUP BY "start", ${groupByColumn}`
    : "GROUP BY \"start\"";
  const orderBy = groupByColumn
    ? `ORDER BY "start" ASC, ${groupByColumn} ASC`
    : "ORDER BY \"start\" ASC";

  if (!groupByColumn) {
    return {
      text: `
        WITH "aggregates" AS MATERIALIZED (
          SELECT ${bucketStart} AS "start", COUNT(*) AS "count"
          FROM "logs"
          WHERE ${queryConditions.join(" AND ")}
          ${groupBy}
        )
        SELECT "start", NULL::text AS "group", "count"
        FROM "aggregates"
        ${orderBy}
      `,
      values: queryParameters,
    };
  }

  return {
    text: `
      SELECT ${bucketStart} AS "start", ${groupSelect}, COUNT(*) AS "count"
      FROM "logs"
      WHERE ${queryConditions.join(" AND ")}
      ${groupBy}
      ${orderBy}
    `,
    values: queryParameters,
  };
}

function resolveGroupByColumn(groupBy: AggregateGroupBy | undefined): string | null {
  if (groupBy === "service") {
    return "\"service\"";
  }

  if (groupBy === "level") {
    return "\"level\"";
  }

  return null;
}

function mapAggregateRow(row: DatabaseAggregateRow): AggregateBucketResult {
  const count = Number(row.count);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Aggregate count exceeds JavaScript safe integer range");
  }

  return {
    start: row.start.toISOString(),
    group: row.group,
    count,
  };
}
