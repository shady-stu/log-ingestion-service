import { readPool } from "../db/pool";
import { type Log, type LogLevel, type LogsQuery, type StoredLog } from "../types";

type DatabaseLog = {
  id: string;
  timestamp: Date;
  level: LogLevel;
  service: string;
  message: string;
  attributes: Log["attributes"];
};

export async function findLogs(query: LogsQuery): Promise<StoredLog[]> {
  const builtQuery = buildLogsQuery(query);
  const result = await readPool.query<DatabaseLog>(
    builtQuery.text,
    builtQuery.values
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    timestamp: row.timestamp.toISOString(),
    level: row.level,
    service: row.service,
    message: row.message,
    attributes: row.attributes,
  }));
}

export function buildLogsQuery(query: LogsQuery) {
  const conditions: string[] = [];
  const values: unknown[] = [];
  const parameter = (value: unknown) => {
    values.push(value);
    return `$${values.length}`;
  };

  if (query.service !== undefined) {
    conditions.push(`"service" = ${parameter(query.service)}`);
  }

  if (query.level !== undefined) {
    conditions.push(`"level" = ${parameter(query.level)}`);
  }

  if (query.since !== undefined) {
    conditions.push(`"timestamp" >= ${parameter(query.since)}::timestamptz`);
  }

  if (query.until !== undefined) {
    conditions.push(`"timestamp" < ${parameter(query.until)}::timestamptz`);
  }

  if (query.q !== undefined) {
    conditions.push(`"message" ILIKE '%' || ${parameter(query.q)} || '%'`);
  }

  for (const attribute of query.attributes) {
    const attributeKey = parameter(attribute.key);
    const attributeValue = parameter(attribute.value);

    conditions.push(
      buildAttributeCondition(attributeKey, attributeValue, attribute.value)
    );
  }

  if (query.cursor) {
    const timestamp = parameter(query.cursor.timestamp);
    const id = parameter(query.cursor.id);
    conditions.push(`("timestamp", "id") < (${timestamp}::timestamptz, ${id}::bigint)`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = parameter(query.limit + 1);

  return {
    text: `
      SELECT "id", "timestamp", "level", "service", "message", "attributes"
      FROM "logs"
      ${where}
      ORDER BY "timestamp" DESC, "id" DESC
      LIMIT ${limit}::int
    `,
    values,
  };
}

export function buildAttributeCondition(
  attributeKey: string,
  attributeValue: string,
  rawValue: string
): string {
  const indexedCandidates = [
    `"attributes" @> jsonb_build_object(${attributeKey}::text, to_jsonb(${attributeValue}::text))`,
  ];

  if (isJsonNumber(rawValue)) {
    indexedCandidates.push(
      `"attributes" @> jsonb_build_object(${attributeKey}::text, to_jsonb(${attributeValue}::numeric))`
    );
  }

  if (rawValue === "true" || rawValue === "false") {
    indexedCandidates.push(
      `"attributes" @> jsonb_build_object(${attributeKey}::text, to_jsonb(${attributeValue}::boolean))`
    );
  }

  // GIN narrows candidates while ->> preserves the API's exact string comparison contract.
  return `(${indexedCandidates.join(" OR ")}) AND "attributes" ->> ${attributeKey} = ${attributeValue}`;
}

function isJsonNumber(value: string): boolean {
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value);
}
