import { FastifyInstance } from "fastify";
import { type BearerAuthHook } from "../auth.js";
import { postLogsHandler } from "../handlers/logs.handler";
import { getLogsAggregateHandler } from "../handlers/logs-aggregate.handler";
import { getLogsHandler } from "../handlers/logs-query.handler";

export async function registerLogsRoutes(
  app: FastifyInstance,
  authHook?: BearerAuthHook
) {
  const routeOptions = { onRequest: authHook ? [authHook] : [] };

  app.get("/logs/aggregate", routeOptions, getLogsAggregateHandler);
  app.get("/logs", routeOptions, getLogsHandler);
  app.post("/logs", routeOptions, postLogsHandler);
}
