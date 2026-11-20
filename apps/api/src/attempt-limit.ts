import type { FastifyInstance } from "fastify";

export interface AttemptLimit {
  maxFailures: number;
  windowMs: number;
}

/** D119: one counter for every request, 10 refusals in 60 seconds. */
export const DEFAULT_ATTEMPT_LIMIT: AttemptLimit = { maxFailures: 10, windowMs: 60000 };

const MAX_PATH = 200;
const MAX_HEADER = 100;
const LIMITED_BODY = { message: "Muitas tentativas recusadas. Tente de novo em instantes." };

function headerText(value: unknown): string | null {
  return typeof value === "string" ? value.slice(0, MAX_HEADER) : null;
}

/** One JSON line at level warn; a missing or throwing `log` is ignored. */
function writeWarn(log: ((message: string) => void) | undefined, entry: Record<string, unknown>) {
  if (log === undefined) return;
  try {
    log(JSON.stringify({ level: "warn", ...entry }));
  } catch {
    // logging must never change the response
  }
}

/**
 * Counts 401 and 403 responses in one window (state lives in this closure) when they are sent, not when they
 * finish, so a parallel burst cannot slip past the limit; once `maxFailures` is reached
 * every request except `/health` gets 429 until the window ends. Each refusal and the limit itself are logged once
 * (never the token or the query), so the limit also caps the log.
 */
export function registerAttemptLimit(
  app: FastifyInstance,
  limit: AttemptLimit,
  now: () => number,
  log?: (message: string) => void,
): void {
  let start = 0;
  let count = 0;
  let warned = false;

  const refresh = (): void => {
    if (count > 0 && now() - start >= limit.windowMs) {
      count = 0;
      warned = false;
    }
  };

  const write = (entry: Record<string, unknown>): void => writeWarn(log, entry);

  app.addHook("onRequest", async (req, reply) => {
    refresh();
    if (count < limit.maxFailures) return;
    if (req.url.split("?")[0] === "/health") return;
    const seconds = Math.ceil((start + limit.windowMs - now()) / 1000);
    return reply.code(429).header("retry-after", String(seconds)).send(LIMITED_BODY);
  });

  app.addHook("onSend", async (req, reply, payload) => {
    if (reply.statusCode !== 401 && reply.statusCode !== 403) return payload;
    refresh();
    if (count === 0) start = now();
    count += 1;
    if (count <= limit.maxFailures) {
      write({
        msg: "request refused",
        status: reply.statusCode,
        method: req.method,
        path: req.url.split("?")[0]?.slice(0, MAX_PATH),
        host: headerText(req.headers.host),
        origin: headerText(req.headers.origin),
      });
    }
    if (count >= limit.maxFailures && !warned) {
      warned = true;
      write({
        msg: "attempt limit reached",
        maxFailures: limit.maxFailures,
        windowMs: limit.windowMs,
      });
    }
    return payload;
  });
}
