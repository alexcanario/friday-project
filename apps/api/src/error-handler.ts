import type { FastifyInstance } from "fastify";

/**
 * Global error handler: a 5xx (or an error without `statusCode`) answers a fixed body and logs the
 * detail; a 4xx goes back to the default Fastify handler, which keeps its status and body.
 * Must be registered before the plugins so that they inherit it.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, req, reply) => {
    const status = (error as { statusCode?: unknown }).statusCode;
    if (typeof status === "number" && status < 500) throw error;
    req.log.error({ err: error }, "unhandled error in request");
    return reply.code(500).send({ error: "Erro interno." });
  });
}
