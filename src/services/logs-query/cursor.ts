import { isValidIsoTimestamp } from "../iso-timestamp";
import { InvalidLogsQueryError } from "./errors";
import { type CursorData } from "../../types";

export function encodeCursor(cursor: CursorData): string {
  return Buffer.from(
    JSON.stringify({ v: 1, timestamp: cursor.timestamp, id: cursor.id }),
    "utf8"
  ).toString("base64url");
}

export function decodeCursor(value: string): CursorData {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw invalidCursor();
  }

  let payload: unknown;

  try {
    const decoded = Buffer.from(value, "base64url");

    if (decoded.toString("base64url") !== value) {
      throw new Error("Non-canonical cursor");
    }

    payload = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw invalidCursor();
  }

  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw invalidCursor();
  }

  const cursor = payload as Record<string, unknown>;

  if (
    cursor.v !== 1 ||
    typeof cursor.timestamp !== "string" ||
    typeof cursor.id !== "string" ||
    !/^[1-9]\d*$/.test(cursor.id) ||
    !isValidIsoTimestamp(cursor.timestamp)
  ) {
    throw invalidCursor();
  }

  return { timestamp: cursor.timestamp, id: cursor.id };
}

function invalidCursor(): InvalidLogsQueryError {
  return new InvalidLogsQueryError("Invalid cursor");
}
