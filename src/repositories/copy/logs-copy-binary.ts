import { type Log } from "../../types";
import { runtimeConfig } from "../../config/runtime-config";

const POSTGRES_EPOCH_MS = Date.UTC(2000, 0, 1);
const COPY_BINARY_HEADER = Buffer.from([
  0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);
const COPY_BINARY_TRAILER = Buffer.from([0xff, 0xff]);
const COPY_COLUMN_COUNT = 5;
const FIELD_LENGTH_BYTES = 4;
const TIMESTAMP_BYTES = 8;
const JSONB_VERSION = 1;

type PreparedRow = {
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
  const rows = logs.map(prepareRow);
  const buffer = Buffer.allocUnsafe(rows.reduce(getPreparedRowSize, 0));
  let offset = 0;

  for (const row of rows) {
    offset = writeRow(buffer, row, offset);
  }

  return buffer;
}

function prepareRow(log: Log): PreparedRow {
  const attributes = JSON.stringify(log.attributes);

  return {
    log,
    attributes,
    timestampMicros: toPostgresTimestampMicros(log.timestamp),
    levelLength: Buffer.byteLength(log.level),
    serviceLength: Buffer.byteLength(log.service),
    messageLength: Buffer.byteLength(log.message),
    attributesLength: Buffer.byteLength(attributes),
  };
}

function toPostgresTimestampMicros(timestamp: string): bigint {
  return BigInt(Date.parse(timestamp) - POSTGRES_EPOCH_MS) * 1000n +
    BigInt(getSubMillisecondMicros(timestamp));
}

function getPreparedRowSize(size: number, row: PreparedRow): number {
  return size + 2 + COPY_COLUMN_COUNT * FIELD_LENGTH_BYTES + TIMESTAMP_BYTES +
    row.levelLength + row.serviceLength + row.messageLength + JSONB_VERSION +
    row.attributesLength;
}

function writeRow(buffer: Buffer, row: PreparedRow, offset: number): number {
  buffer.writeInt16BE(COPY_COLUMN_COUNT, offset);
  offset += 2;
  offset = writeTimestamp(buffer, row.timestampMicros, offset);
  offset = writeTextField(buffer, row.log.level, row.levelLength, offset);
  offset = writeTextField(buffer, row.log.service, row.serviceLength, offset);
  offset = writeTextField(buffer, row.log.message, row.messageLength, offset);
  return writeJsonbField(buffer, row.attributes, row.attributesLength, offset);
}

function writeTimestamp(buffer: Buffer, micros: bigint, offset: number): number {
  buffer.writeInt32BE(TIMESTAMP_BYTES, offset);
  buffer.writeBigInt64BE(micros, offset + FIELD_LENGTH_BYTES);
  return offset + FIELD_LENGTH_BYTES + TIMESTAMP_BYTES;
}

function writeTextField(
  buffer: Buffer,
  value: string,
  byteLength: number,
  offset: number
): number {
  buffer.writeInt32BE(byteLength, offset);
  return offset + FIELD_LENGTH_BYTES +
    buffer.write(value, offset + FIELD_LENGTH_BYTES, byteLength, "utf8");
}

function writeJsonbField(
  buffer: Buffer,
  value: string,
  byteLength: number,
  offset: number
): number {
  buffer.writeInt32BE(byteLength + JSONB_VERSION, offset);
  offset += FIELD_LENGTH_BYTES;
  buffer.writeUInt8(JSONB_VERSION, offset++);
  return offset + buffer.write(value, offset, byteLength, "utf8");
}

function getSubMillisecondMicros(timestamp: string): number {
  const match = /\.(\d{1,9})(?:Z|[+-]\d{2}:?\d{2})$/.exec(timestamp);

  return !match || match[1].length <= 3
    ? 0
    : Number(match[1].slice(3, 6).padEnd(3, "0"));
}
