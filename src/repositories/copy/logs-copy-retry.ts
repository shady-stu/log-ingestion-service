import { isWriterReady } from "../../db/writer";
import { type Log } from "../../types";
import { copyLogs } from "./logs-copy";

const DB_ERROR_LOG_INTERVAL_MS = 5000;
let lastDbErrorLogAt = 0;

export async function copyLogsWithRetry(
  logsData: Log[],
  maxAttempts: number
): Promise<void> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await copyLogs(logsData);
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

  return code === "40001" ||
    code === "40P01" ||
    code === "53300" ||
    code === "57P01" ||
    code === "57P02" ||
    code === "57P03" ||
    code === "08000" ||
    code === "08001" ||
    code === "08003" ||
    code === "08004" ||
    code === "08006" ||
    code === "08007" ||
    code === "08P01";
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
