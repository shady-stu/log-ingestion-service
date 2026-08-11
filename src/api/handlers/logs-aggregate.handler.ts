import { FastifyReply, FastifyRequest } from "fastify";
import { parseAggregateQuery } from "../../services/logs-aggregate/parser";
import { LogsAggregateService } from "../../services/logs-aggregate.service";

const service = new LogsAggregateService();

export function createGetLogsAggregateHandler(aggregateService = service) {
  return async function getLogsAggregateHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ) {
    const query = parseAggregateQuery(request.query);
    const result = await aggregateService.aggregate(query);

    return reply.code(200).send(result);
  };
}

export const getLogsAggregateHandler = createGetLogsAggregateHandler();
