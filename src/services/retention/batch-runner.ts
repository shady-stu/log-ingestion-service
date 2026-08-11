import { type DeleteExpiredBatch, type RetentionSettings } from "./types";

export class RetentionBatchRunner {
  private stopRequested = false;

  constructor(
    private readonly deleteBatch: DeleteExpiredBatch,
    private readonly settings: RetentionSettings
  ) {}

  resume(): void {
    this.stopRequested = false;
  }

  stop(): void {
    this.stopRequested = true;
  }

  async run(): Promise<number> {
    const retentionMs = this.settings.retentionDays * 24 * 60 * 60 * 1000;
    const cutoff = new Date(this.settings.now() - retentionMs);

    if (Number.isNaN(cutoff.getTime())) {
      throw new Error("Retention cutoff is outside the supported date range");
    }

    let totalDeleted = 0;

    for (let batch = 0; batch < this.settings.maxBatchesPerRun; batch++) {
      if (this.stopRequested) {
        break;
      }

      const deleted = await this.deleteBatch(cutoff, this.settings.batchSize);
      totalDeleted += deleted;

      if (deleted < this.settings.batchSize || this.stopRequested) {
        break;
      }

      await this.settings.pause(this.settings.pauseMs);
    }

    return totalDeleted;
  }
}
