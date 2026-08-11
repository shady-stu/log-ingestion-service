import { FastifyInstance } from "fastify";
import { healthHandler } from "../handlers/health.handler";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", healthHandler);
}