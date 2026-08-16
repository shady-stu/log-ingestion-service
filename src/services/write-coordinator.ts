import { insertLogs } from "../repositories/logs.repository";
import { type Log } from "../types";

const TARGET_COPY_BATCH = 15000;
const MAX_PENDING_LOGS = 30000;
const FLUSH_DELAY_MS = 3;

type PendingWrite = {
  logs: Log[];
  resolve: (accepted: number) => void;
  reject: (error: unknown) => void;
};

type CapacityWaiter = {
  logs: Log[];
  resolve: (accepted: number) => void;
  reject: (error: unknown) => void;
};

type WriteCoordinatorOptions = {
  targetCopyBatch?: number;
  maxPendingLogs?: number;
  flushDelayMs?: number;
};

export type WriteBatch = (logs: Log[]) => Promise<void>;

export class WriteCoordinator {
  private readonly targetCopyBatch: number;
  private readonly maxPendingLogs: number;
  private readonly flushDelayMs: number;
  private readonly pendingWrites: PendingWrite[] = [];
  private readonly capacityWaiters: CapacityWaiter[] = [];
  private pendingLogCount = 0;
  private peakPendingLogCount = 0;
  private flushTimer: NodeJS.Timeout | undefined;
  private flushPromise: Promise<void> | undefined;
  private accepting = true;

  constructor(
    private readonly writeBatch: WriteBatch,
    options: WriteCoordinatorOptions = {}
  ) {
    this.targetCopyBatch = options.targetCopyBatch ?? TARGET_COPY_BATCH;
    this.maxPendingLogs = options.maxPendingLogs ?? MAX_PENDING_LOGS;
    this.flushDelayMs = options.flushDelayMs ?? FLUSH_DELAY_MS;
  }

  persist(logs: Log[]): Promise<number> {
    if (logs.length === 0) {
      return Promise.resolve(0);
    }

    if (logs.length > this.maxPendingLogs) {
      return Promise.reject(new Error("Write batch exceeds coordinator capacity"));
    }

    if (!this.accepting) {
      return Promise.reject(new Error("Write coordinator is shutting down"));
    }

    return new Promise<number>((resolve, reject) => {
      if (this.pendingLogCount + logs.length <= this.maxPendingLogs) {
        this.enqueueWrite({ logs, resolve, reject });
      } else {
        this.capacityWaiters.push({ logs, resolve, reject });
      }
    });
  }

  getStats() {
    return {
      pendingLogs: this.pendingLogCount,
      peakPendingLogs: this.peakPendingLogCount,
      pendingRequests: this.pendingWrites.length,
      waitingForCapacity: this.capacityWaiters.length,
      writing: this.flushPromise !== undefined,
    };
  }

  async shutdown(): Promise<void> {
    if (!this.accepting) {
      await this.waitForFlushCompletion();
      return;
    }

    this.accepting = false;
    this.clearFlushTimer();
    const shutdownError = new Error("Write coordinator is shutting down");

    for (const waiter of this.capacityWaiters.splice(0)) {
      waiter.reject(shutdownError);
    }

    if (this.pendingWrites.length > 0) {
      this.startFlush();
    }

    await this.waitForFlushCompletion();
  }

  private scheduleFlush(): void {
    if (this.flushTimer || this.flushPromise) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.startFlush();
    }, this.flushDelayMs);
    this.flushTimer.unref();
  }

  private startFlush(): void {
    if (this.flushPromise) {
      return;
    }

    this.clearFlushTimer();
    const flush = this.flushPending();
    this.flushPromise = flush;

    void flush.finally(() => {
      if (this.flushPromise === flush) {
        this.flushPromise = undefined;
      }

      if (this.pendingWrites.length > 0) {
        if (!this.accepting || this.pendingLogCount >= this.targetCopyBatch) {
          this.startFlush();
        } else {
          this.scheduleFlush();
        }
      }
    });
  }

  private async flushPending(): Promise<void> {
    while (this.pendingWrites.length > 0) {
      const writes = this.takeNextBatch();
      const logs = combineLogs(writes);

      try {
        await this.writeBatch(logs);

        for (const write of writes) {
          write.resolve(write.logs.length);
        }
      } catch (error) {
        for (const write of writes) {
          write.reject(error);
        }
      } finally {
        this.pendingLogCount -= logs.length;
        this.releaseCapacityWaiters();
      }
    }
  }

  private takeNextBatch(): PendingWrite[] {
    let logCount = 0;
    let writeCount = 0;

    while (
      writeCount < this.pendingWrites.length &&
      logCount < this.targetCopyBatch
    ) {
      logCount += this.pendingWrites[writeCount].logs.length;
      writeCount++;
    }

    return this.pendingWrites.splice(0, writeCount);
  }

  private releaseCapacityWaiters(): void {
    let availableLogs = this.maxPendingLogs - this.pendingLogCount;
    let waiterCount = 0;

    while (waiterCount < this.capacityWaiters.length) {
      const waiter = this.capacityWaiters[waiterCount];

      if (waiter.logs.length > availableLogs) {
        break;
      }

      availableLogs -= waiter.logs.length;
      waiterCount++;
    }

    if (waiterCount === 0) {
      return;
    }

    const releasedWaiters = this.capacityWaiters.splice(0, waiterCount);

    for (const waiter of releasedWaiters) {
      this.pendingWrites.push(waiter);
      this.pendingLogCount += waiter.logs.length;
    }

    this.peakPendingLogCount = Math.max(
      this.peakPendingLogCount,
      this.pendingLogCount
    );
  }

  private enqueueWrite(write: PendingWrite): void {
    this.pendingWrites.push(write);
    this.pendingLogCount += write.logs.length;
    this.peakPendingLogCount = Math.max(
      this.peakPendingLogCount,
      this.pendingLogCount
    );

    if (this.pendingLogCount >= this.targetCopyBatch) {
      this.startFlush();
    } else {
      this.scheduleFlush();
    }
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
  }

  private async waitForFlushCompletion(): Promise<void> {
    while (this.flushPromise) {
      await this.flushPromise;
    }
  }
}

function combineLogs(writes: PendingWrite[]): Log[] {
  const totalLogs = writes.reduce((total, write) => total + write.logs.length, 0);
  const logs = new Array<Log>(totalLogs);
  let index = 0;

  for (const write of writes) {
    for (const log of write.logs) {
      logs[index++] = log;
    }
  }

  return logs;
}

export const writeCoordinator = new WriteCoordinator(async (logs) => {
  await insertLogs(logs);
});
