import type { IncomingHttpHeaders } from "node:http";

const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "proxy-connection", "te", "trailer", "upgrade"];

// Headers that only describe one connection must not cross the proxy (RFC 9110 §7.6.1).
// `transfer-encoding` stays: the body is forwarded with `pipe`.
export function stripHopByHop(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const raw = headers.connection as string | string[] | undefined;
  const named = [raw ?? []].flat().flatMap((value) => value.split(",").map((name) => name.trim().toLowerCase()));
  const drop = new Set([...HOP_BY_HOP, ...named.filter(Boolean)]);
  return Object.fromEntries(Object.entries(headers).filter(([name]) => !drop.has(name.toLowerCase())));
}
