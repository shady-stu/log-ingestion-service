import { type LogLevel, type LogValidationResult } from "../../types";
import { parseIsoTimestamp } from "../iso-timestamp";
import { parseAttributes } from "./attributes";

const MAX_FUTURE_SKEW_MS = 5 * 60 * 1000;
const LEVELS = new Set<LogLevel>(["debug", "info", "warn", "error"]);

export function validateLog(value: unknown, now = Date.now()): LogValidationResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return reject("log must be an object");
  }

  const candidate = value as Record<string, unknown>;
  const timestamp = parseTimestamp(candidate.timestamp, now);

  if (!timestamp) {
    return reject("timestamp must be a valid ISO datetime");
  }

  if (!isLogLevel(candidate.level)) {
    return reject(`invalid level: '${String(candidate.level)}'`);
  }

  if (typeof candidate.service !== "string" || candidate.service.length === 0) {
    return reject("service must be a non-empty string");
  }

  if (typeof candidate.message !== "string" || candidate.message.length === 0) {
    return reject("message must be a non-empty string");
  }

  const attributes = parseAttributes(candidate.attributes);

  if (!attributes) {
    return reject(
      "attributes must be a flat object with string, number, or boolean values"
    );
  }

  return {
    timestamp,
    level: candidate.level,
    service: candidate.service,
    message: candidate.message,
    attributes,
  };
}

function parseTimestamp(value: unknown, now: number): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const timestampMs = parseIsoTimestamp(value);

  return timestampMs !== null && timestampMs - now <= MAX_FUTURE_SKEW_MS
    ? value
    : null;
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && LEVELS.has(value as LogLevel);
}

function reject(reason: string): string {
  return reason;
}
