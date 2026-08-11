import { from as copyFrom } from "pg-copy-streams";
import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { getWriterClient } from "../../db/writer";
import { type Log } from "../../types";
import { toCopyBinaryChunks } from "./logs-copy-binary";

const COPY_LOGS_SQL = `
  COPY logs ("timestamp", "level", "service", "message", "attributes")
  FROM STDIN
  WITH (FORMAT binary)
`;

export async function copyLogs(logsData: Log[]): Promise<void> {
  const client = getWriterClient();

  await pipeline(
    Readable.from(toCopyBinaryChunks(logsData)),
    client.query(copyFrom(COPY_LOGS_SQL))
  );
}
