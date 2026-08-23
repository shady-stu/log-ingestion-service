const ISO_DATETIME_PATTERN =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:?\d{2})$/;

export function isValidIsoTimestamp(value: string): boolean {
  return parseIsoTimestamp(value) !== null;
}

export function parseIsoTimestamp(value: string): number | null {
  const parts = ISO_DATETIME_PATTERN.exec(value);

  if (!parts || !isValidDateTimeParts(parts)) {
    return null;
  }

  const timestampMs = Date.parse(value);
  return Number.isNaN(timestampMs) ? null : timestampMs;
}

function isValidDateTimeParts(parts: RegExpExecArray): boolean {
  const year = Number(parts[1]);
  const month = Number(parts[2]);
  const day = Number(parts[3]);
  const hour = Number(parts[4]);
  const minute = Number(parts[5]);
  const second = Number(parts[6]);
  const zone = parts[7];

  if (
    month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month) ||
    hour > 23 || minute > 59 || second > 59
  ) {
    return false;
  }

  return zone === "Z" ||
    (Number(zone.slice(1, 3)) <= 23 && Number(zone.slice(-2)) <= 59);
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) {
    return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28;
  }

  return month === 4 || month === 6 || month === 9 || month === 11 ? 30 : 31;
}
