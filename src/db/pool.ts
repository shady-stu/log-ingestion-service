import { Pool } from "pg";
import { runtimeConfig } from "../config/runtime-config";
import { databaseClientConfig } from "./config";

const POOL_ERROR_LOG_INTERVAL_MS = 5000;
const READ_POOL_MAX = 4;
let lastPoolErrorLogAt = 0;

const readPool = new Pool({
  ...databaseClientConfig,
  max: READ_POOL_MAX,
  idleTimeoutMillis: runtimeConfig.pgIdleTimeoutMs,
  options: "-c max_parallel_workers_per_gather=0",
});

readPool.on("error", (err) => {
  const now = Date.now();

  if (now - lastPoolErrorLogAt < POOL_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastPoolErrorLogAt = now;
  console.error("Unexpected error on idle PostgreSQL client", {
    code: (err as Error & { code?: string }).code,
    message: err.message,
  });
});

export async function closeReadPool(): Promise<void> {
  await readPool.end();
}

export { readPool };
