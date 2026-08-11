import { runtimeConfig } from "../../config";
import { type RetentionOptions, type RetentionSettings } from "./types";

const DEFAULT_BATCH_SIZE = 1000;
const DEFAULT_INTERVAL_MS = 60 * 60 * 1000;
const DEFAULT_PAUSE_MS = 25;
const DEFAULT_MAX_BATCHES_PER_RUN = 100;

export function resolveRetentionOptions(
  options: RetentionOptions
): RetentionSettings {
  return {
    retentionDays: positiveInteger(
      options.retentionDays ?? runtimeConfig.retentionDays,
      "retentionDays"
    ),
    batchSize: positiveInteger(
      options.batchSize ?? DEFAULT_BATCH_SIZE,
      "batchSize"
    ),
    intervalMs: positiveInteger(
      options.intervalMs ?? DEFAULT_INTERVAL_MS,
      "intervalMs"
    ),
    pauseMs: nonNegativeInteger(
      options.pauseMs ?? DEFAULT_PAUSE_MS,
      "pauseMs"
    ),
    maxBatchesPerRun: positiveInteger(
      options.maxBatchesPerRun ?? DEFAULT_MAX_BATCHES_PER_RUN,
      "maxBatchesPerRun"
    ),
    now: options.now ?? Date.now,
    pause: options.pause ?? wait,
    onError: options.onError ?? logRetentionError,
  };
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }

  return value;
}

function nonNegativeInteger(value: number, name: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }

  return value;
}

function wait(durationMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

function logRetentionError(error: unknown): void {
  const retentionError = error as { code?: string; message?: string };

  console.error("Scheduled log retention failed", {
    code: retentionError.code,
    message: retentionError.message,
  });
}
