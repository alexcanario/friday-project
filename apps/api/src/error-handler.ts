import type { FastifyInstance } from "fastify";
import { logError } from "./error-log.ts";

/**
 * Global error handler: only a true 4xx (`statusCode` 400 to 499) goes back to the default Fastify
 * handler, which keeps its status and body; anything else (5xx, no `statusCode`, or a `statusCode`
 * outside the error range) answers a fixed 500 body and logs the detail.
 * Must be registered before the plugins so that they inherit it.
 */
export function registerErrorHandler(app: FastifyInstance, log?: (message: string) => void): void {
  app.setErrorHandler((error, req, reply) => {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status >= 400 && status < 500) throw error;
    logError(log, "unhandled error in request", req, error);
    return reply.code(500).send({ error: "Erro interno." });
  });
}
