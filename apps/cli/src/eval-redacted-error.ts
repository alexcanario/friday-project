/** The most `Error` objects in the `.cause` chain of a masked error, the top one included. */
const MAX_CHAIN = 5;

/**
 * A copy of the error with the tokens masked (the review token included, #551 note 1): the
 * `message`, the `stack` and the `cause` chain (at most five `Error` objects; a cause that is not
 * an `Error` becomes its masked text).
 */
export function redactedError(error: unknown, redact: (text: string) => string, depth = 0): Error {
  const message = error instanceof Error ? error.message : String(error);
  const masked = new Error(redact(message));
  const stack = error instanceof Error ? error.stack : masked.stack;
  if (stack !== undefined) masked.stack = redact(stack);
  const cause = error instanceof Error ? error.cause : undefined;
  if (cause === undefined) return masked;
  if (!(cause instanceof Error)) {
    masked.cause = redact(String(cause));
  } else if (depth + 1 < MAX_CHAIN) {
    masked.cause = redactedError(cause, redact, depth + 1);
  }
  return masked;
}
