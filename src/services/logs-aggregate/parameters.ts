import { type AggregateGroupBy } from "../../types";
import { InvalidLogsQueryError } from "../logs-query";
import { parseAggregateBucket } from "./bucket";

const AGGREGATE_PARAMETERS = new Set([
  "since",
  "until",
  "bucket",
  "service",
  "level",
  "q",
  "group_by",
]);

export function readAggregateQuery(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidQuery("Invalid query parameters");
  }

  const query = value as Record<string, unknown>;

  for (const key of Object.keys(query)) {
    if (!key.startsWith("attr.") && !AGGREGATE_PARAMETERS.has(key)) {
      throw invalidQuery("Invalid query parameter");
    }
  }

  return query;
}

export function readRequiredBucket(value: unknown) {
  const bucket = readSingleValue(value, "Missing or invalid bucket parameter");
  const parsedBucket = parseAggregateBucket(bucket);

  if (!parsedBucket) {
    throw invalidQuery("Invalid bucket parameter");
  }

  return parsedBucket;
}

export function readGroupBy(value: unknown): AggregateGroupBy | undefined {
  if (value === undefined) {
    return undefined;
  }

  const groupBy = readSingleValue(value, "Invalid group_by parameter");

  if (groupBy !== "service" && groupBy !== "level") {
    throw invalidQuery("Invalid group_by parameter");
  }

  return groupBy;
}

function readSingleValue(value: unknown, errorMessage: string): string {
  const values = Array.isArray(value) ? value : [value];

  if (values.length !== 1 || typeof values[0] !== "string") {
    throw invalidQuery(errorMessage);
  }

  return values[0];
}

function invalidQuery(message: string): InvalidLogsQueryError {
  return new InvalidLogsQueryError(message);
}
