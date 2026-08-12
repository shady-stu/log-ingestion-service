import { FastifyInstance } from "fastify";
import { createBearerAuthHook, type BearerAuthHook } from "../auth.js";
import { registerAdminRoutes } from "./admin.js";
import { registerHealthRoutes } from "./health.js";
import { registerLogsRoutes } from "./logs.js";
import { runtimeConfig } from "../../config";

export async function registerRoutes(app: FastifyInstance) {
  const authHook = createRouteAuthHook();

  await registerHealthRoutes(app, authHook);
  await registerLogsRoutes(app, authHook);
  await registerAdminRoutes(app);
}

function createRouteAuthHook(): BearerAuthHook | undefined {
  return runtimeConfig.authEnabled && runtimeConfig.loadgenApiKey
    ? createBearerAuthHook(runtimeConfig.loadgenApiKey)
    : undefined;
}
