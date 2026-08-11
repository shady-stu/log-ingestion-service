export type LogLevel = "debug" | "info" | "warn" | "error";

export type LogAttributes = Record<string, string | number | boolean>;

export type Log = {
  timestamp: string;
  level: LogLevel;
  service: string;
  message: string;
  attributes: LogAttributes;
};

export type CreateLogInput = Omit<Log, "attributes"> & {
  attributes?: LogAttributes;
};

export type StoredLog = Log & {
  id: string;
};
