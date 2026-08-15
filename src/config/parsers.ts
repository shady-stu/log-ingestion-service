import {
  DEFAULT_DATABASE_URL,
  type NodeEnvironment,
} from "./constants";

export function parseInteger(
  value: string | undefined,
  name: string,
  defaultValue: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER
): number {
  if (value === undefined) {
    return defaultValue;
  }

  if (!/^\d+$/.test(value)) {
    throw new Error(`${name} must be an integer`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }

  return parsed;
}

export function parseBoolean(
  value: string | undefined,
  name: string,
  defaultValue: boolean
): boolean {
  if (value === undefined) {
    return defaultValue;
  }

  if (value !== "true" && value !== "false") {
    throw new Error(`${name} must be true or false`);
  }

  return value === "true";
}

export function parseEnum<T extends string>(
  value: string | undefined,
  name: string,
  defaultValue: T,
  allowed: readonly T[]
): T {
  const selected = value ?? defaultValue;

  if (!allowed.includes(selected as T)) {
    throw new Error(`${name} is invalid`);
  }

  return selected as T;
}

export function parseDatabaseUrl(
  value: string | undefined,
  nodeEnv: NodeEnvironment
): string {
  const databaseUrl =
    value || (nodeEnv === "production" ? undefined : DEFAULT_DATABASE_URL);

  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in production");
  }

  let url: URL;

  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  return databaseUrl;
}
