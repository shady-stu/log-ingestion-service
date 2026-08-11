import {
  type AttributeFilter,
  type CursorData,
  type LogsQuery,
} from "../../types";
import { decodeCursor } from "./cursor";
import { InvalidLogsQueryError } from "./errors";
import {
  parseQueryLevel,
  parseQueryLimit,
  parseQueryTimestamp,
  readQueryValues,
  readSingleQueryValue,
} from "./parameters";

const DEFAULT_LIMIT = 100;

export function parseLogsQuery(value: unknown): LogsQuery {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw invalidQuery("Invalid query parameters");
  }

  const raw = value as Record<string, unknown>;
  const attributes: AttributeFilter[] = [];
  let service: string | undefined;
  let level: LogsQuery["level"];
  let since: string | undefined;
  let until: string | undefined;
  let q: string | undefined;
  let limit = DEFAULT_LIMIT;
  let cursor: CursorData | undefined;

  for (const [key, rawValue] of Object.entries(raw)) {
    if (key.startsWith("attr.")) {
      const attributeKey = key.slice("attr.".length);

      if (!attributeKey) {
        throw invalidQuery("Invalid attribute filter");
      }

      for (const value of readQueryValues(rawValue, "Invalid attribute filter")) {
        attributes.push({ key: attributeKey, value });
      }

      continue;
    }

    const parameter = readSingleQueryValue(rawValue, `Invalid ${key} parameter`);

    switch (key) {
      case "service":
        service = parameter;
        break;
      case "level":
        level = parseQueryLevel(parameter);
        break;
      case "since":
        since = parseQueryTimestamp(parameter, "Invalid since");
        break;
      case "until":
        until = parseQueryTimestamp(parameter, "Invalid until");
        break;
      case "q":
        q = parameter;
        break;
      case "limit":
        limit = parseQueryLimit(parameter);
        break;
      case "cursor":
        cursor = decodeCursor(parameter);
        break;
      default:
        throw invalidQuery("Invalid query parameter");
    }
  }

  if (since && until && Date.parse(until) <= Date.parse(since)) {
    throw invalidQuery("until must be greater than since");
  }

  return { service, level, since, until, q, limit, cursor, attributes };
}

function invalidQuery(message: string): InvalidLogsQueryError {
  return new InvalidLogsQueryError(message);
}
