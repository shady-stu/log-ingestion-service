import { type LogLevel } from "../../types";
import { isValidIsoTimestamp } from "../iso-timestamp";
import { InvalidLogsQueryError } from "./errors";

const MAX_LIMIT = 1000;
const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

export function parseQueryLevel(value: string): LogLevel {
  if (!LEVELS.has(value as LogLevel)) {
    throw new InvalidLogsQueryError("Invalid level");
  }

  return value as LogLevel;
}

export function parseQueryTimestamp(value: string, errorMessage: string): string {
  if (!isValidIsoTimestamp(value)) {
    throw new InvalidLogsQueryError(errorMessage);
  }

  return value;
}

export function readSingleQueryValue(
  value: unknown,
  errorMessage: string
): string {
  const values = readQueryValues(value, errorMessage);

  if (values.length !== 1) {
    throw new InvalidLogsQueryError(errorMessage);
  }

  return values[0];
}

export function readQueryValues(
  value: unknown,
  errorMessage: string
): string[] {
  const values = Array.isArray(value) ? value : [value];

  if (values.length === 0 || values.some((entry) => typeof entry !== "string")) {
    throw new InvalidLogsQueryError(errorMessage);
  }

  return values as string[];
}

export function parseQueryLimit(value: string): number {
  if (!/^\d+$/.test(value)) {
    throw new InvalidLogsQueryError("Invalid limit");
  }

  const limit = Number(value);

  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw new InvalidLogsQueryError("Invalid limit");
  }

  return limit;
}
