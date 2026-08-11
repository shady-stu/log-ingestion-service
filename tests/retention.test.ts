import { buildDeleteExpiredLogsQuery } from "../src/repositories/retention.repository";
import { RetentionService } from "../src/services/retention.service";

describe("retention repository SQL", () => {
  it("builds a deterministic bounded and parameterized deletion", () => {
    const cutoff = new Date("2026-07-13T12:00:00.000Z");
    const query = buildDeleteExpiredLogsQuery(cutoff, 1000);

    expect(query.text).toContain('WHERE "timestamp" < $1::timestamptz');
    expect(query.text).toContain('ORDER BY "timestamp" ASC, "id" ASC');
    expect(query.text).toContain("LIMIT $2::int");
    expect(query.text).toContain('DELETE FROM "logs"');
    expect(query.values).toEqual([cutoff.toISOString(), 1000]);
    expect(query.text).not.toContain(cutoff.toISOString());
  });

  it.each([0, -1, 1.5, Number.NaN])("rejects invalid batch size %s", (batchSize) => {
    expect(() => buildDeleteExpiredLogsQuery(new Date(), batchSize)).toThrow(
      "Retention batch size must be a positive integer"
    );
  });
});

describe("RetentionService", () => {
  const now = Date.parse("2026-01-31T00:00:00.000Z");
  const cutoff = "2026-01-01T00:00:00.000Z";

  it("deletes expired logs while preserving recent and exact-boundary logs", async () => {
    const rows = [
      { id: 1, timestamp: "2025-12-31T23:59:59.999Z" },
      { id: 2, timestamp: cutoff },
      { id: 3, timestamp: "2026-01-01T00:00:00.001Z" },
    ];
    const deleteBatch = jest.fn(async (cutoffDate: Date, batchSize: number) => {
      const expired = rows
        .filter((row) => Date.parse(row.timestamp) < cutoffDate.getTime())
        .slice(0, batchSize);
      const expiredIds = new Set(expired.map((row) => row.id));

      for (let index = rows.length - 1; index >= 0; index--) {
        if (expiredIds.has(rows[index].id)) {
          rows.splice(index, 1);
        }
      }

      return expired.length;
    });
    const service = createService(deleteBatch, { now: () => now, batchSize: 2 });

    await expect(service.runOnce()).resolves.toBe(1);
    expect(deleteBatch).toHaveBeenCalledWith(new Date(cutoff), 2);
    expect(rows.map((row) => row.id)).toEqual([2, 3]);
  });

  it("processes multiple bounded batches and yields between full batches", async () => {
    const deleteBatch = jest.fn()
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(1);
    const pause = jest.fn(async () => undefined);
    const service = createService(deleteBatch, { batchSize: 2, pause });

    await expect(service.runOnce()).resolves.toBe(5);
    expect(deleteBatch).toHaveBeenCalledTimes(3);
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("returns zero for an empty retention run", async () => {
    const deleteBatch = jest.fn().mockResolvedValue(0);
    const service = createService(deleteBatch);

    await expect(service.runOnce()).resolves.toBe(0);
    expect(deleteBatch).toHaveBeenCalledTimes(1);
  });

  it("surfaces a directly requested run failure", async () => {
    const failure = new Error("database unavailable");
    const service = createService(async () => Promise.reject(failure));

    await expect(service.runOnce()).rejects.toBe(failure);
  });

  it("reports scheduled failures without crashing or overlapping", async () => {
    jest.useFakeTimers();
    const onError = jest.fn();
    const deleteBatch = jest.fn().mockRejectedValue(new Error("scheduled failure"));
    const service = createService(deleteBatch, { intervalMs: 10, onError });

    service.start();
    jest.advanceTimersByTime(10);
    await flushPromises();

    expect(deleteBatch).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);

    await service.stop();
    jest.runOnlyPendingTimers();
    expect(deleteBatch).toHaveBeenCalledTimes(1);
    jest.useRealTimers();
  });

  it("joins an active run instead of starting a concurrent run", async () => {
    const deletion = deferred<number>();
    const deleteBatch = jest.fn(async () => deletion.promise);
    const service = createService(deleteBatch);

    const first = service.runOnce();
    const second = service.runOnce();

    expect(deleteBatch).toHaveBeenCalledTimes(1);
    deletion.resolve(0);
    await expect(Promise.all([first, second])).resolves.toEqual([0, 0]);
  });

  it("stops scheduling and waits for active work to finish", async () => {
    const deletion = deferred<number>();
    const deleteBatch = jest.fn(async () => deletion.promise);
    const service = createService(deleteBatch, { batchSize: 2 });
    const run = service.runOnce();
    const stopping = service.stop();
    let stopped = false;
    void stopping.then(() => {
      stopped = true;
    });

    await Promise.resolve();
    expect(stopped).toBe(false);

    deletion.resolve(2);
    await expect(run).resolves.toBe(2);
    await stopping;
    expect(deleteBatch).toHaveBeenCalledTimes(1);
    expect(stopped).toBe(true);
  });
});

function createService(
  deleteBatch: (cutoff: Date, batchSize: number) => Promise<number>,
  options: ConstructorParameters<typeof RetentionService>[1] = {}
) {
  return new RetentionService(deleteBatch, {
    retentionDays: 30,
    batchSize: 1000,
    pauseMs: 0,
    maxBatchesPerRun: 10,
    now: () => Date.parse("2026-01-31T00:00:00.000Z"),
    ...options,
  });
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

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
