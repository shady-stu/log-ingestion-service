import { FastifyInstance } from "fastify";
import { postLogsHandler } from "../handlers/logs.handler";
import { getLogsAggregateHandler } from "../handlers/logs-aggregate.handler";
import { getLogsHandler } from "../handlers/logs-query.handler";

export async function registerLogsRoutes(app: FastifyInstance) {
  app.get("/logs/aggregate", getLogsAggregateHandler);
  app.get("/logs", getLogsHandler);
  app.post("/logs", postLogsHandler);
}
