import { type LogsAggregateQuery } from "../../types";
import { InvalidLogsQueryError, parseLogsQuery } from "../logs-query";
import { readAggregateQuery, readGroupBy, readRequiredBucket } from "./parameters";

export function parseAggregateQuery(value: unknown): LogsAggregateQuery {
  const raw = readAggregateQuery(value);
  const bucket = readRequiredBucket(raw.bucket);
  const groupBy = readGroupBy(raw.group_by);
  const sharedQuery = parseLogsQuery(removeAggregateParameters(raw));

  if (!sharedQuery.since) {
    throw invalidQuery("Missing since parameter");
  }

  if (!sharedQuery.until) {
    throw invalidQuery("Missing until parameter");
  }

  return {
    since: sharedQuery.since,
    until: sharedQuery.until,
    bucket,
    groupBy,
    service: sharedQuery.service,
    level: sharedQuery.level,
    q: sharedQuery.q,
    attributes: sharedQuery.attributes,
  };
}

function removeAggregateParameters(raw: Record<string, unknown>) {
  const sharedParameters = { ...raw };
  delete sharedParameters.bucket;
  delete sharedParameters.group_by;
  return sharedParameters;
}

function invalidQuery(message: string): InvalidLogsQueryError {
  return new InvalidLogsQueryError(message);
}
