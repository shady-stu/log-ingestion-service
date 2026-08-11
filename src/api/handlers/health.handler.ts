import { FastifyReply, FastifyRequest } from "fastify";
import { isWriterReady } from "../../db/writer";

export async function healthHandler(
  request: FastifyRequest,
  reply: FastifyReply
) {
  const ready = isWriterReady();

  return reply.code(ready ? 200 : 503).send({
    status: ready ? "ok" : "unavailable",
  });
}
