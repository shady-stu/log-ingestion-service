import { Client } from "pg";
import { databaseClientConfig } from "./config";

const WRITER_ERROR_LOG_INTERVAL_MS = 5000;
let writerClient: Client | undefined;
let writerReady = false;
let lastWriterErrorLogAt = 0;

export async function connectWriter(): Promise<void> {
  if (writerReady) {
    return;
  }

  const client = new Client(databaseClientConfig);
  writerClient = client;

  client.on("error", (error) => {
    if (writerClient === client) {
      writerReady = false;
    }

    logWriterError(error);
  });

  try {
    await client.connect();
    writerReady = true;
  } catch (error) {
    writerClient = undefined;
    throw error;
  }
}

export function getWriterClient(): Client {
  if (!writerClient || !writerReady) {
    throw new Error("PostgreSQL writer is not ready");
  }

  return writerClient;
}

export function isWriterReady(): boolean {
  return writerReady;
}

export async function closeWriter(): Promise<void> {
  const client = writerClient;
  writerClient = undefined;
  writerReady = false;

  if (client) {
    await client.end();
  }
}

function logWriterError(error: Error): void {
  const now = Date.now();

  if (now - lastWriterErrorLogAt < WRITER_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastWriterErrorLogAt = now;
  console.error("Unexpected error on dedicated PostgreSQL writer", {
    code: (error as Error & { code?: string }).code,
    message: error.message,
  });
}
