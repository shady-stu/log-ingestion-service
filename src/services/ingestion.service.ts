import { validateLog } from "./log-validator";
import { type IngestionResult, type Log, type RejectedLog } from "../types";
import { writeCoordinator } from "./write-coordinator";
import { runtimeConfig } from "../config";

export type PersistLogs = (logs: Log[]) => Promise<number>;

export class LogsService {
  constructor(
    private readonly persistLogs: PersistLogs = (logs) => writeCoordinator.persist(logs),
    private readonly insertBatchSize = runtimeConfig.insertBatchSize
  ) {}

  async ingest(input: unknown[]): Promise<IngestionResult> {
    let accepted = 0;
    let batch: Log[] = [];

    const rejected: RejectedLog[] = [];
    const now = Date.now();

    for (let index = 0; index < input.length; index++) {
      const result = validateLog(input[index], now);

      if (typeof result === "string") {
        rejected.push({
          index,
          reason: result,
        });

        continue;
      }

      batch.push(result);

      if (batch.length === this.insertBatchSize) {
        accepted += await this.persistLogs(batch);
        batch = [];
      }
    }

    if (batch.length > 0) {
      accepted += await this.persistLogs(batch);
    }

    return {
      accepted,
      rejected,
    };
  }
}
