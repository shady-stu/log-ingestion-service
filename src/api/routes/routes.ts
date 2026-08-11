import { FastifyInstance } from "fastify";
import { registerAdminRoutes } from "./admin.js";
import { registerHealthRoutes } from "./health.js";
import { registerLogsRoutes } from "./logs.js";

export async function registerRoutes(app: FastifyInstance) {
  await registerHealthRoutes(app);
  await registerLogsRoutes(app);
  await registerAdminRoutes(app);
}
