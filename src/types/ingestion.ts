import { type Log } from "./logs";

export type RejectedLog = {
  index: number;
  reason: string;
};

export type IngestionResult = {
  accepted: number;
  rejected: RejectedLog[];
};

export type LogValidationResult = Log | string;
