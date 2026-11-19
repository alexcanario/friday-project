import { timingSafeEqual } from "node:crypto";

/** Fail-closed comparison of the `x-friday-token` header with the configured token, in bytes; never throws. */
export function isPanelTokenValid(header: unknown, expected: string | undefined): boolean {
  if (expected === undefined || expected === "") return false;
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
