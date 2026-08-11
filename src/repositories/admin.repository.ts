import { readPool } from "../db/pool";

export async function truncateLogs(): Promise<void> {
  await readPool.query("TRUNCATE TABLE logs RESTART IDENTITY");
}
