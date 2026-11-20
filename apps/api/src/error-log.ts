const MAX_DEPTH = 5;

type Log = ((message: string) => void) | undefined;

/** `{ name, message, stack, cause }` of an `Error` (cause nested up to 5 levels); `String(value)` otherwise. */
function serialize(error: unknown, depth: number): unknown {
  if (!(error instanceof Error)) return String(error);
  return {
    name: error.name,
    message: error.message,
    stack: error.stack,
    cause:
      depth >= MAX_DEPTH || error.cause === undefined
        ? undefined
        : serialize(error.cause, depth + 1),
  };
}

/**
 * Writes one JSON line through `log`: level, msg, method, path (no query) and the serialized error.
 * Never includes headers, query string or body. A missing or throwing `log` is ignored.
 */
export function logError(
  log: Log,
  msg: string,
  req: { method: string; url: string },
  error: unknown,
): void {
  if (log === undefined) return;
  try {
    const path = req.url.split("?")[0];
    log(
      JSON.stringify({ level: "error", msg, method: req.method, path, err: serialize(error, 1) }),
    );
  } catch {
    // logging must never change the response
  }
}
