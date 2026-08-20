import { timingSafeEqual } from "crypto";
import { type FastifyReply, type FastifyRequest } from "fastify";

export type AuthScope = "ingest" | "query";

export type BearerAuthHook = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void>;

type AuthOptions = {
  requiredScopes?: readonly AuthScope[];
  grantedScopes?: readonly AuthScope[];
};

type FailedAttempt = {
  count: number;
  resetAt: number;
};

const AUTH_WINDOW_MS = 60_000;
const AUTH_FAILURE_LIMIT = 10;
const MAX_TRACKED_CLIENTS = 10_000;
const failedAttempts = new Map<string, FailedAttempt>();
const FULL_ACCESS_SCOPES: readonly AuthScope[] = ["ingest", "query"];

export function createBearerAuthHook(
  expectedKey: string | undefined,
  options: AuthOptions = {}
): BearerAuthHook {
  const requiredScopes = options.requiredScopes ?? [];
  const grantedScopes = new Set(options.grantedScopes ?? FULL_ACCESS_SCOPES);

  return async function requireBearerAuth(request, reply) {
    const providedKey = readProvidedKey(request);

    if (!expectedKey || !providedKey || !keysMatch(expectedKey, providedKey)) {
      const retryAfter = recordFailedAttempt(request.ip);

      if (retryAfter !== undefined) {
        reply
          .code(429)
          .header("Retry-After", String(retryAfter))
          .send({ error: "Too Many Requests" });
        return;
      }

      reply.code(401).send({ error: "Unauthorized" });
      return;
    }

    failedAttempts.delete(request.ip);

    if (requiredScopes.some((scope) => !grantedScopes.has(scope))) {
      reply.code(403).send({ error: "Forbidden" });
    }
  };

  function readProvidedKey(request: FastifyRequest): string | undefined {
    if (!expectedKey) {
      return undefined;
    }

    const authorization = request.headers.authorization;
    const apiKey = request.headers["x-api-key"];
    const candidates: string[] = [];

    if (typeof authorization === "string" && authorization.startsWith("Bearer ")) {
      const bearerKey = authorization.slice("Bearer ".length);

      if (bearerKey.length > 0) {
        candidates.push(bearerKey);
      }
    }

    if (typeof apiKey === "string" && apiKey.length > 0) {
      candidates.push(apiKey);
    }

    return candidates.find((candidate) => keysMatch(expectedKey, candidate));
  }
}

function keysMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}

function recordFailedAttempt(clientKey: string): number | undefined {
  const now = Date.now();
  const current = failedAttempts.get(clientKey);

  if (!current || current.resetAt <= now) {
    failedAttempts.set(clientKey, {
      count: 1,
      resetAt: now + AUTH_WINDOW_MS,
    });
    trimFailedAttempts();
    return undefined;
  }

  if (current.count >= AUTH_FAILURE_LIMIT) {
    return Math.max(1, Math.ceil((current.resetAt - now) / 1000));
  }

  current.count += 1;
  return undefined;
}

function trimFailedAttempts(): void {
  while (failedAttempts.size > MAX_TRACKED_CLIENTS) {
    const oldestClient = failedAttempts.keys().next().value;

    if (oldestClient === undefined) {
      return;
    }

    failedAttempts.delete(oldestClient);
  }
}
