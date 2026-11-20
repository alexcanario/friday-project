import { timingSafeEqual } from "node:crypto";

/** Shortest accepted panel token, in characters. */
export const PANEL_TOKEN_MIN_LENGTH = 32;

/** True only for ASCII letters and digits with at least `PANEL_TOKEN_MIN_LENGTH` characters. */
export function isPanelTokenFormatValid(token: string): boolean {
  return token.length >= PANEL_TOKEN_MIN_LENGTH && /^[A-Za-z0-9]+$/.test(token);
}

/** Fail-closed comparison of the `x-friday-token` header with the configured token, in bytes; never throws. */
export function isPanelTokenValid(header: unknown, expected: string | undefined): boolean {
  if (expected === undefined || expected === "") return false;
  if (typeof header !== "string") return false;
  const a = Buffer.from(header);
  const b = Buffer.from(expected);
  if (a.byteLength !== b.byteLength) return false;
  return timingSafeEqual(a, b);
}
