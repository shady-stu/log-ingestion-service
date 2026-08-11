export class RetentionTimer {
  private timer: NodeJS.Timeout | undefined;
  private started = false;

  constructor(
    private readonly intervalMs: number,
    private readonly run: () => Promise<void>,
    private readonly onError: (error: unknown) => void
  ) {}

  start(): void {
    if (this.started) {
      return;
    }

    this.started = true;
    this.scheduleNextRun();
  }

  stop(): void {
    this.started = false;

    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private scheduleNextRun(): void {
    if (!this.started || this.timer) {
      return;
    }

    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.runCycle();
    }, this.intervalMs);
    this.timer.unref();
  }

  private async runCycle(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      this.onError(error);
    } finally {
      this.scheduleNextRun();
    }
  }
}
