import { isWriterReady } from "../../db/writer";
import { type Log } from "../../types";
import { copyLogs } from "./logs-copy";

const DB_ERROR_LOG_INTERVAL_MS = 5000;
const RETRYABLE_DB_CODES = new Set([
  "40001",
  "40P01",
  "53300",
  "57P01",
  "57P02",
  "57P03",
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
]);
let lastDbErrorLogAt = 0;

type CopyBatch = (logsData: Log[]) => Promise<void>;

export async function copyLogsWithRetry(
  logsData: Log[],
  maxAttempts: number,
  copyBatch: CopyBatch = copyLogs
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await copyBatch(logsData);
      return;
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableDbError(error)) {
        logBatchInsertError(error, logsData.length, attempt, maxAttempts);
        throw error;
      }

      await new Promise((resolve) => setTimeout(resolve, 100 * attempt));
    }
  }
}

function isRetryableDbError(error: unknown): boolean {
  const code = (error as { code?: string }).code;

  return typeof code === "string" && RETRYABLE_DB_CODES.has(code);
}

function logBatchInsertError(
  error: unknown,
  batchSize: number,
  attempt: number,
  maxAttempts: number
) {
  const now = Date.now();

  if (now - lastDbErrorLogAt < DB_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastDbErrorLogAt = now;
  const dbError = error as {
    code?: string;
    message?: string;
    severity?: string;
  };

  console.error("Failed to copy log batch", {
    batchSize,
    attempt,
    maxAttempts,
    code: dbError.code,
    severity: dbError.severity,
    message: dbError.message,
    writerReady: isWriterReady(),
  });
}
