import { FastifyReply, FastifyRequest } from "fastify";
import { LogsService } from "../../services/ingestion.service";

const service = new LogsService();

type IngestionService = Pick<LogsService, "ingest">;

export function createPostLogsHandler(ingestionService: IngestionService = service) {
  return async function postLogsHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const logs = getLogsArray(request.body);

    if (!logs) {
      return reply.code(400).send({
        error: "Invalid request body",
      });
    }

    const result = await ingestionService.ingest(logs);
    const status = result.accepted > 0 ? 200 : 400;

    return reply.code(status).send(result);
  };
}

export const postLogsHandler = createPostLogsHandler();

function getLogsArray(body: unknown): unknown[] | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }

  const logs = (body as { logs?: unknown }).logs;

  return Array.isArray(logs) && logs.length > 0
    ? logs
    : null;
}
