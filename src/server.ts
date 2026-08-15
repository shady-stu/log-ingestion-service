import Fastify, { FastifyError } from "fastify";
import { runtimeConfig } from "./config/runtime-config";

const APP_ERROR_LOG_INTERVAL_MS = 5000;
let lastAppErrorLogAt = 0;

export const server = Fastify({
  logger: runtimeConfig.nodeEnv === "production"
    ? false
    : { level: runtimeConfig.logLevel },
  bodyLimit: runtimeConfig.bodyLimitBytes,
});

server.setErrorHandler((error: FastifyError, request, reply) => {
  const statusCode = error.statusCode ?? 500;

  if (statusCode >= 500) {
    logServerError(error);
  }

  reply.status(statusCode).send({
    error: statusCode >= 500
      ? "Internal Server Error"
      : error.message,
  });
});

function logServerError(error: FastifyError) {
  const now = Date.now();

  if (now - lastAppErrorLogAt < APP_ERROR_LOG_INTERVAL_MS) {
    return;
  }

  lastAppErrorLogAt = now;

  console.error("Unhandled request error", {
    code: error.code,
    statusCode: error.statusCode,
    message: error.message,
  });
}
