import { FastifyInstance } from "fastify";
import { deleteLogsHandler } from "../handlers/admin.handler";
import { runtimeConfig } from "../../config";

export async function registerAdminRoutes(app: FastifyInstance) {
  if (runtimeConfig.logsPurgeToken) {
    app.delete("/logs", deleteLogsHandler);
  }
}
