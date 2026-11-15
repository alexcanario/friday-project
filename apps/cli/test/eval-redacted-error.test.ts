import { expect, it } from "vitest";
import { createRedactor } from "@friday/daemon";
import { redactedError } from "../src/eval-redacted-error.ts";

const redact = createRedactor({ A: "author-tok", R: "review-tok" }, ["A", "R"]);

function chainOf(error: Error): Error[] {
  const chain: Error[] = [];
  let current: unknown = error;
  while (current instanceof Error) {
    chain.push(current);
    current = current.cause;
  }
  return chain;
}

it("keeps the stack and the cause with the tokens masked and stops at five levels", () => {
  const masked = redactedError(
    new Error("falhou author-tok", { cause: new Error("causa review-tok") }),
    redact,
  );
  expect(masked).toBeInstanceOf(Error);
  expect(masked.message).toBe("falhou ***");
  expect(masked.stack).not.toContain("author-tok");
  expect(masked.stack).not.toContain("review-tok");
  expect(masked.stack).toContain("falhou ***");
  const cause = masked.cause as Error;
  expect(cause).toBeInstanceOf(Error);
  expect(cause.message).toBe("causa ***");
  expect(cause.stack).not.toContain("review-tok");

  const text = redactedError(new Error("x", { cause: "texto author-tok" }), redact);
  expect(text.cause).toBe("texto ***");

  const a = new Error("a");
  const b = new Error("b");
  a.cause = b;
  b.cause = a;
  const chain = chainOf(redactedError(a, redact));
  expect(chain).toHaveLength(5);
  expect(chain[4]!.cause).toBeUndefined();

  expect(redactedError("falhou author-tok", redact).message).toBe("falhou ***");
});
