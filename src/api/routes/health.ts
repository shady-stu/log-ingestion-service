import { FastifyInstance } from "fastify";
import { type BearerAuthHook } from "../auth.js";
import { healthHandler } from "../handlers/health.handler";

export async function registerHealthRoutes(
  app: FastifyInstance,
  authHook?: BearerAuthHook
) {
  app.get("/health", { onRequest: authHook ? [authHook] : [] }, healthHandler);
}
