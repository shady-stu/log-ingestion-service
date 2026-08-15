import { timingSafeEqual } from "crypto";
import { FastifyReply, FastifyRequest } from "fastify";
import { truncateLogs } from "../../repositories/admin.repository";
import { runtimeConfig } from "../../config/runtime-config";

type TruncateLogs = () => Promise<void>;

export function createDeleteLogsHandler(
  expectedToken = runtimeConfig.logsPurgeToken,
  truncate: TruncateLogs = truncateLogs
) {
  return async function deleteLogsHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    if (!hasValidAdminToken(request, expectedToken)) {
      return reply.code(401).send({ error: "Unauthorized" });
    }

    await truncate();

    return reply.code(200).send({ truncated: true });
  };
}

export const deleteLogsHandler = createDeleteLogsHandler();

function hasValidAdminToken(
  request: FastifyRequest,
  expectedToken: string | undefined
): boolean {
  const providedToken = request.headers["x-logs-purge-token"];

  return Boolean(
    expectedToken &&
    typeof providedToken === "string" &&
    tokensMatch(expectedToken, providedToken)
  );
}

function tokensMatch(expected: string, provided: string) {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}
