import { FastifyInstance } from "fastify";
import { type BearerAuthHook } from "../auth.js";
import { postLogsHandler } from "../handlers/logs.handler";
import { getLogsAggregateHandler } from "../handlers/logs-aggregate.handler";
import { getLogsHandler } from "../handlers/logs-query.handler";

export async function registerLogsRoutes(
  app: FastifyInstance,
  queryAuthHook?: BearerAuthHook,
  ingestAuthHook?: BearerAuthHook
) {
  const queryRouteOptions = {
    onRequest: queryAuthHook ? [queryAuthHook] : [],
  };
  const ingestRouteOptions = {
    onRequest: ingestAuthHook ? [ingestAuthHook] : [],
  };

  app.get("/logs/aggregate", queryRouteOptions, getLogsAggregateHandler);
  app.get("/logs", queryRouteOptions, getLogsHandler);
  app.post("/logs", ingestRouteOptions, postLogsHandler);
}
