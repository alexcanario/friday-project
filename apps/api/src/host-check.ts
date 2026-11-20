import type { FastifyInstance } from "fastify";

/** Names the API answers to: loopback with the real port plus the host of each allowed origin. */
export function allowedHostsOf(port: number, origins: readonly string[]): string[] {
  const hosts = [`127.0.0.1:${port}`, `localhost:${port}`];
  for (const origin of origins) {
    if (origin === "*" || origin === "null") continue;
    let host: string;
    try {
      host = new URL(origin).host;
    } catch {
      continue;
    }
    if (host !== "" && !hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/** Exact match, case-insensitive; anything that is not a single string header is refused. */
export function isHostAllowed(host: unknown, allowed: readonly string[]): boolean {
  return typeof host === "string" && allowed.includes(host.toLowerCase());
}

/** Refuses every request with an unknown `Host` (DNS rebinding, D118); `X-Forwarded-Host` is never read. */
export function registerHostCheck(
  app: FastifyInstance,
  allowedHosts: () => readonly string[],
): void {
  app.addHook("onRequest", async (req, reply) => {
    if (!isHostAllowed(req.headers.host, allowedHosts())) {
      return reply.code(403).send({ message: "Host não permitido." });
    }
  });
}
