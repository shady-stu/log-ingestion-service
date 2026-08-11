import { type Log } from "../../types";
import { runtimeConfig } from "../../config";

const POSTGRES_EPOCH_MS = Date.UTC(2000, 0, 1);
const COPY_BINARY_HEADER = Buffer.from([
  0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const COPY_BINARY_TRAILER = Buffer.from([0xff, 0xff]);

type CopyRow = {
  log: Log;
  attributes: string;
  timestampMicros: bigint;
  levelLength: number;
  serviceLength: number;
  messageLength: number;
  attributesLength: number;
};

export function* toCopyBinaryChunks(logsData: Log[]): Generator<Buffer> {
  let chunk: Log[] = [];
  const chunkSize = runtimeConfig.copySerializeChunkSize;

  yield COPY_BINARY_HEADER;

  for (const log of logsData) {
    chunk.push(log);

    if (chunk.length === chunkSize) {
      yield serializeCopyBinaryChunk(chunk);
      chunk = [];
    }
  }

  if (chunk.length > 0) {
    yield serializeCopyBinaryChunk(chunk);
  }

  yield COPY_BINARY_TRAILER;
}

function serializeCopyBinaryChunk(logs: Log[]): Buffer {
  const rows = logs.map(toCopyRow);
  const buffer = Buffer.allocUnsafe(rows.reduce(getRowSize, 0));
  let offset = 0;

  for (const row of rows) {
    buffer.writeInt16BE(5, offset);
    offset += 2;
    offset = writeCopyInt64(buffer, row.timestampMicros, offset);
    offset = writeCopyText(buffer, row.log.level, row.levelLength, offset);
    offset = writeCopyText(buffer, row.log.service, row.serviceLength, offset);
    offset = writeCopyText(buffer, row.log.message, row.messageLength, offset);
    buffer.writeInt32BE(row.attributesLength + 1, offset);
    offset += 4;
    buffer.writeUInt8(1, offset++);
    offset += buffer.write(row.attributes, offset, row.attributesLength, "utf8");
  }

  return buffer;
}

function toCopyRow(log: Log): CopyRow {
  const attributes = JSON.stringify(log.attributes);
  const timestampMs = Date.parse(log.timestamp);

  return {
    log,
    attributes,
    timestampMicros:
      BigInt(timestampMs - POSTGRES_EPOCH_MS) * 1000n +
      BigInt(getSubMillisecondMicros(log.timestamp)),
    levelLength: Buffer.byteLength(log.level),
    serviceLength: Buffer.byteLength(log.service),
    messageLength: Buffer.byteLength(log.message),
    attributesLength: Buffer.byteLength(attributes),
  };
}

function getRowSize(size: number, row: CopyRow): number {
  return size + 2 + 5 * 4 + 8 + row.levelLength + row.serviceLength +
    row.messageLength + 1 + row.attributesLength;
}

function writeCopyInt64(buffer: Buffer, value: bigint, offset: number): number {
  buffer.writeInt32BE(8, offset);
  buffer.writeBigInt64BE(value, offset + 4);
  return offset + 12;
}

function writeCopyText(
  buffer: Buffer,
  value: string,
  byteLength: number,
  offset: number
): number {
  buffer.writeInt32BE(byteLength, offset);
  return offset + 4 + buffer.write(value, offset + 4, byteLength, "utf8");
}

function getSubMillisecondMicros(timestamp: string): number {
  const match = /\.(\d{1,9})(?:Z|[+-]\d{2}:?\d{2})$/.exec(timestamp);

  return !match || match[1].length <= 3
    ? 0
    : Number(match[1].slice(3, 6).padEnd(3, "0"));
}
