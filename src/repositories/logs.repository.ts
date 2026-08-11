import { copyLogsWithRetry } from "./copy/logs-copy-retry";
import { type Log } from "../types";

const DEFAULT_INSERT_ATTEMPTS = 1;

export async function insertLogs(
  logsData: Log[],
  maxAttempts = DEFAULT_INSERT_ATTEMPTS
): Promise<number> {
  if (logsData.length === 0) {
    return 0;
  }

  await copyLogsWithRetry(logsData, maxAttempts);
  return logsData.length;
}
