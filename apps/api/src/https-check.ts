import type { FastifyInstance } from "fastify";

const HSTS = "max-age=31536000";

/** True for `127.0.0.1`, `localhost` and `[::1]`, any case. */
export function isLoopbackHostname(hostname: string): boolean {
  const name = hostname.toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

function hostnameOf(host: unknown): string | null {
  if (typeof host !== "string") return null;
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return null;
  }
}

/** Every item of the comma list is exactly `https` (lowercase, no spaces after normalising); absent or empty fails. */
function isMarkedHttps(value: unknown): boolean {
  if (typeof value !== "string" || value === "") return false;
  return value.split(",").every((item) => item.trim().toLowerCase() === "https");
}

/**
 * Outside loopback only HTTPS is served (D118): the daemon listens on 127.0.0.1 and the proxy
 * terminates TLS, so the proxy must say `https` in `x-forwarded-proto`. Fails closed.
 * `X-Forwarded-Host` is never read.
 */
export function registerHttpsCheck(app: FastifyInstance): void {
  app.addHook("onRequest", async (req, reply) => {
    const hostname = hostnameOf(req.headers.host);
    if (hostname !== null && isLoopbackHostname(hostname)) return;
    if (!isMarkedHttps(req.headers["x-forwarded-proto"])) {
      return reply.code(403).send({ message: "HTTPS obrigatório." });
    }
    reply.header("strict-transport-security", HSTS);
  });
}
