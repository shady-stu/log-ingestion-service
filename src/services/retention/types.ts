export type DeleteExpiredBatch = (
  cutoff: Date,
  batchSize: number
) => Promise<number>;

export type RetentionOptions = {
  retentionDays?: number;
  batchSize?: number;
  intervalMs?: number;
  pauseMs?: number;
  maxBatchesPerRun?: number;
  now?: () => number;
  pause?: (durationMs: number) => Promise<void>;
  onError?: (error: unknown) => void;
};

export type RetentionSettings = {
  retentionDays: number;
  batchSize: number;
  intervalMs: number;
  pauseMs: number;
  maxBatchesPerRun: number;
  now: () => number;
  pause: (durationMs: number) => Promise<void>;
  onError: (error: unknown) => void;
};
