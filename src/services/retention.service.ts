import { deleteExpiredLogsBatch } from "../repositories/retention.repository";
import { RetentionBatchRunner } from "./retention/batch-runner";
import { resolveRetentionOptions } from "./retention/options";
import { RetentionTimer } from "./retention/timer";
import { type DeleteExpiredBatch, type RetentionOptions } from "./retention/types";


export type { RetentionOptions } from "./retention/types";
export class RetentionService {
  private readonly runner: RetentionBatchRunner;
  private readonly timer: RetentionTimer;
  private activeRun: Promise<number> | undefined;

  constructor(
    deleteBatch: DeleteExpiredBatch = deleteExpiredLogsBatch,
    options: RetentionOptions = {}
  ) {
    const settings = resolveRetentionOptions(options);
    this.runner = new RetentionBatchRunner(deleteBatch, settings);
    this.timer = new RetentionTimer(
      settings.intervalMs,
      async () => void await this.runOnce(),
      settings.onError
    );
  }

  start(): void {
    this.runner.resume();
    this.timer.start();
  }

  async runOnce(): Promise<number> {
    if (this.activeRun) {
      return this.activeRun;
    }

    const run = this.runner.run();
    this.activeRun = run;

    try {
      return await run;
    } finally {
      if (this.activeRun === run) {
        this.activeRun = undefined;
      }
    }
  }

  async stop(): Promise<void> {
    this.timer.stop();
    this.runner.stop();

    if (this.activeRun) {
      await this.activeRun.catch(() => undefined);
    }
  }
}

export const retentionService = new RetentionService();
