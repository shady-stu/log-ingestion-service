import { toCopyBinaryChunks } from "../src/repositories/copy/logs-copy-binary";
import { type Log } from "../src/types";

const COPY_BINARY_HEADER = Buffer.from([
  0x50, 0x47, 0x43, 0x4f, 0x50, 0x59, 0x0a, 0xff, 0x0d, 0x0a, 0x00,
  0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
]);

describe("PostgreSQL binary COPY serialization", () => {
  it("writes only the protocol header and trailer for an empty batch", () => {
    expect([...toCopyBinaryChunks([])]).toEqual([
      COPY_BINARY_HEADER,
      Buffer.from([0xff, 0xff]),
    ]);
  });

  it("preserves UTF-8 fields, JSONB versioning, and microsecond timestamps", () => {
    const log: Log = {
      timestamp: "2000-01-01T00:00:00.123456Z",
      level: "error",
      service: "checkout",
      message: "payment caf\\u00e9",
      attributes: { user_id: "42", reason: "d\\u00e9clined" },
    };
    const chunks = [...toCopyBinaryChunks([log])];
    const row = chunks[1];
    let offset = 0;

    expect(chunks[0]).toEqual(COPY_BINARY_HEADER);
    expect(chunks[2]).toEqual(Buffer.from([0xff, 0xff]));
    expect(row.readInt16BE(offset)).toBe(5);
    offset += 2;

    expect(row.readInt32BE(offset)).toBe(8);
    expect(row.readBigInt64BE(offset + 4)).toBe(123456n);
    offset += 12;

    [log.level, log.service, log.message].forEach((value) => {
      const length = row.readInt32BE(offset);
      offset += 4;
      expect(row.subarray(offset, offset + length).toString("utf8")).toBe(value);
      offset += length;
    });

    const jsonbLength = row.readInt32BE(offset);
    offset += 4;
    expect(row.readUInt8(offset)).toBe(1);
    offset += 1;
    expect(row.subarray(offset, offset + jsonbLength - 1).toString("utf8"))
      .toBe(JSON.stringify(log.attributes));
    expect(offset + jsonbLength - 1).toBe(row.length);
  });
});
