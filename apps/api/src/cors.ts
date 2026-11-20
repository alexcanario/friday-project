import type { FastifyInstance } from "fastify";

/**
 * Hand-written CORS: exact origin match against `allowedOrigins`, `*` never matches.
 * Every response to a request with `Origin` carries `vary: Origin`; only listed origins get `access-control-*`.
 */
export function registerCors(app: FastifyInstance, allowedOrigins: readonly string[]): void {
  const allowed = new Set(allowedOrigins.filter((o) => o !== "*"));
  app.addHook("onRequest", async (req, reply) => {
    const origin = req.headers.origin;
    if (typeof origin !== "string") return;
    reply.header("vary", "Origin");
    const isAllowed = allowed.has(origin);
    if (isAllowed) reply.header("access-control-allow-origin", origin);
    if (req.method !== "OPTIONS") return;
    if (!isAllowed) return reply.code(403).send({ message: "Origem não permitida." });
    return reply
      .header("access-control-allow-headers", "x-friday-token, last-event-id")
      .header("access-control-allow-methods", "GET, POST, OPTIONS")
      .code(204)
      .send();
  });
}
