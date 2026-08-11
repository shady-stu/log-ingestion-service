import { LogsService } from "../src/services/ingestion.service";
import { WriteCoordinator } from "../src/services/write-coordinator";
import { type Log } from "../src/types";

describe("WriteCoordinator", () => {
  it("coalesces requests and resolves each only after COPY succeeds", async () => {
    const copyCompleted = deferred<void>();
    const writeBatch = jest.fn(async () => copyCompleted.promise);
    const coordinator = new WriteCoordinator(writeBatch, {
      targetCopyBatch: 3,
      maxPendingLogs: 10,
      flushDelayMs: 1000,
    });
    const first = coordinator.persist([createLog("first")]);
    const second = coordinator.persist([
      createLog("second-a"),
      createLog("second-b"),
    ]);
    let firstResolved = false;
    void first.then(() => {
      firstResolved = true;
    });

    await nextTurn();

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(writeBatch.mock.calls[0][0].map((log) => log.message)).toEqual([
      "first",
      "second-a",
      "second-b",
    ]);
    expect(firstResolved).toBe(false);

    copyCompleted.resolve();

    await expect(first).resolves.toBe(1);
    await expect(second).resolves.toBe(2);
    await coordinator.shutdown();
  });

  it("rejects every request represented by a failed COPY", async () => {
    const failure = new Error("COPY failed");
    const coordinator = new WriteCoordinator(
      async () => Promise.reject(failure),
      { targetCopyBatch: 2, maxPendingLogs: 10, flushDelayMs: 1000 }
    );

    const results = await Promise.allSettled([
      coordinator.persist([createLog("first")]),
      coordinator.persist([createLog("second")]),
    ]);

    expect(results).toEqual([
      { status: "rejected", reason: failure },
      { status: "rejected", reason: failure },
    ]);
    await coordinator.shutdown();
  });

  it("keeps validation results scoped to their original request", async () => {
    const persist = jest.fn(async (logs: Log[]) => logs.length);
    const service = new LogsService(persist);

    const [first, second] = await Promise.all([
      service.ingest([
        createLog("accepted-first"),
        { ...createLog("rejected-first"), level: "critical" },
      ]),
      service.ingest([
        { ...createLog("rejected-second"), message: "" },
        createLog("accepted-second"),
      ]),
    ]);

    expect(first.accepted).toBe(1);
    expect(first.rejected).toEqual([
      { index: 1, reason: "invalid level: 'critical'" },
    ]);
    expect(second.accepted).toBe(1);
    expect(second.rejected).toEqual([
      { index: 0, reason: "message must be a non-empty string" },
    ]);
  });

  it("flushes pending writes before shutdown completes", async () => {
    const copyCompleted = deferred<void>();
    const writeBatch = jest.fn(async () => copyCompleted.promise);
    const coordinator = new WriteCoordinator(writeBatch, {
      targetCopyBatch: 10,
      maxPendingLogs: 20,
      flushDelayMs: 10000,
    });
    const persistence = coordinator.persist([createLog("pending")]);

    await nextTurn();
    const shutdown = coordinator.shutdown();
    let shutdownCompleted = false;
    void shutdown.then(() => {
      shutdownCompleted = true;
    });

    await nextTurn();

    expect(writeBatch).toHaveBeenCalledTimes(1);
    expect(shutdownCompleted).toBe(false);

    copyCompleted.resolve();

    await expect(persistence).resolves.toBe(1);
    await shutdown;
    expect(shutdownCompleted).toBe(true);
  });

  it("holds new requests outside the bounded pending-log capacity", async () => {
    const firstCopyCompleted = deferred<void>();
    const writeBatch = jest.fn()
      .mockImplementationOnce(async () => firstCopyCompleted.promise)
      .mockImplementation(async () => undefined);
    const coordinator = new WriteCoordinator(writeBatch, {
      targetCopyBatch: 2,
      maxPendingLogs: 2,
      flushDelayMs: 10000,
    });
    const first = coordinator.persist([
      createLog("first-a"),
      createLog("first-b"),
    ]);

    await nextTurn();

    const waiting = coordinator.persist([createLog("waiting")]);
    await nextTurn();

    expect(coordinator.getStats()).toMatchObject({
      pendingLogs: 2,
      peakPendingLogs: 2,
      waitingForCapacity: 1,
    });
    expect(writeBatch).toHaveBeenCalledTimes(1);

    firstCopyCompleted.resolve();
    await expect(first).resolves.toBe(2);
    await expect(waiting).resolves.toBe(1);
    await coordinator.shutdown();
    expect(coordinator.getStats()).toMatchObject({
      pendingLogs: 0,
      peakPendingLogs: 2,
      waitingForCapacity: 0,
    });
    expect(writeBatch).toHaveBeenCalledTimes(2);
  });
});

function createLog(message: string): Log {
  return {
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "info",
    service: "test",
    message,
    attributes: {},
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}
