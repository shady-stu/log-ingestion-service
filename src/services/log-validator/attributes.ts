import { type Log } from "../../types";

const EMPTY_ATTRIBUTES = Object.freeze({}) as Log["attributes"];

export function parseAttributes(value: unknown): Log["attributes"] | null {
  if (value === undefined) {
    return EMPTY_ATTRIBUTES;
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const attributes = value as Record<string, unknown>;

  for (const key in attributes) {
    if (!Object.hasOwn(attributes, key)) {
      continue;
    }

    const attribute = attributes[key];

    if (
      typeof attribute !== "string" &&
      typeof attribute !== "number" &&
      typeof attribute !== "boolean"
    ) {
      return null;
    }
  }

  return attributes as Log["attributes"];
}
