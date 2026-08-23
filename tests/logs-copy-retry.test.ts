import { copyLogsWithRetry } from "../src/repositories/copy/logs-copy-retry";
import { type Log } from "../src/types";
import { jest } from "@jest/globals";

const logs = [createLog()];

describe("COPY retry behavior", () => {
  beforeEach(() => {
    jest.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("retries a retryable database error up to the configured limit", async () => {
    const copyBatch = jest.fn<(batch: Log[]) => Promise<void>>()
      .mockRejectedValueOnce({ code: "40001" })
      .mockResolvedValueOnce(undefined);

    await expect(copyLogsWithRetry(logs, 2, copyBatch)).resolves.toBeUndefined();
    expect(copyBatch).toHaveBeenCalledTimes(2);
    expect(copyBatch).toHaveBeenCalledWith(logs);
  });

  it("does not retry a non-retryable database error", async () => {
    const failure = { code: "23505", message: "unique violation" };
    const copyBatch = jest.fn<(batch: Log[]) => Promise<void>>()
      .mockRejectedValue(failure);

    await expect(copyLogsWithRetry(logs, 3, copyBatch)).rejects.toBe(failure);
    expect(copyBatch).toHaveBeenCalledTimes(1);
  });

  it("stops after the configured retry attempt limit", async () => {
    const failure = { code: "08006", message: "connection failure" };
    const copyBatch = jest.fn<(batch: Log[]) => Promise<void>>()
      .mockRejectedValue(failure);

    await expect(copyLogsWithRetry(logs, 2, copyBatch)).rejects.toBe(failure);
    expect(copyBatch).toHaveBeenCalledTimes(2);
  });
});

function createLog(): Log {
  return {
    timestamp: "2025-01-01T00:00:00.000Z",
    level: "info",
    service: "test",
    message: "test",
    attributes: {},
  };
}
