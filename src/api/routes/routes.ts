import { FastifyInstance } from "fastify";
import {
  createBearerAuthHook,
  type AuthScope,
  type BearerAuthHook,
} from "../auth.js";
import { registerAdminRoutes } from "./admin.js";
import { registerHealthRoutes } from "./health.js";
import { registerLogsRoutes } from "./logs.js";
import { runtimeConfig } from "../../config/runtime-config";

export async function registerRoutes(app: FastifyInstance) {
  const queryAuthHook = createRouteAuthHook(["query"]);
  const ingestAuthHook = createRouteAuthHook(["ingest"]);

  await registerHealthRoutes(app);
  await registerLogsRoutes(app, queryAuthHook, ingestAuthHook);
  await registerAdminRoutes(app);
}

function createRouteAuthHook(
  requiredScopes: readonly AuthScope[] = []
): BearerAuthHook | undefined {
  return runtimeConfig.authEnabled
    ? createBearerAuthHook(runtimeConfig.loadgenApiKey, { requiredScopes })
    : undefined;
}
