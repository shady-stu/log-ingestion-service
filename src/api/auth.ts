import { timingSafeEqual } from "crypto";
import { type FastifyReply, type FastifyRequest } from "fastify";

export type BearerAuthHook = (
  request: FastifyRequest,
  reply: FastifyReply
) => Promise<void>;

export function createBearerAuthHook(expectedKey: string): BearerAuthHook {
  return async function requireBearerAuth(request, reply) {
    const authorization = request.headers.authorization;
    const providedKey = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : undefined;

    if (!providedKey || !keysMatch(expectedKey, providedKey)) {
      reply.code(401).send({ error: "Unauthorized" });
    }
  };
}

function keysMatch(expected: string, provided: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const providedBuffer = Buffer.from(provided);

  return expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer);
}
