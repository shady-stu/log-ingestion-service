import { readPool } from "../db/pool";

export async function deleteExpiredLogsBatch(
  cutoff: Date,
  batchSize: number
): Promise<number> {
  const query = buildDeleteExpiredLogsQuery(cutoff, batchSize);
  const result = await readPool.query(query.text, query.values);

  return result.rowCount ?? 0;
}

export function buildDeleteExpiredLogsQuery(cutoff: Date, batchSize: number) {
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error("Retention cutoff must be a valid date");
  }

  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error("Retention batch size must be a positive integer");
  }

  return {
    text: `
      WITH "expired" AS MATERIALIZED (
        SELECT "id"
        FROM "logs"
        WHERE "timestamp" < $1::timestamptz
        ORDER BY "timestamp" ASC, "id" ASC
        LIMIT $2::int
      )
      DELETE FROM "logs"
      USING "expired"
      WHERE "logs"."id" = "expired"."id"
    `,
    values: [cutoff.toISOString(), batchSize],
  };
}
