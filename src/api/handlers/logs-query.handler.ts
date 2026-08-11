import { FastifyReply, FastifyRequest } from "fastify";
import { parseLogsQuery } from "../../services/logs-query";
import { LogsQueryService } from "../../services/logs-query.service";

const service = new LogsQueryService();

export function createGetLogsHandler(queryService = service) {
  return async function getLogsHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const query = parseLogsQuery(request.query);
    const result = await queryService.query(query);

    return reply.code(200).send(result);
  };
}

export const getLogsHandler = createGetLogsHandler();
