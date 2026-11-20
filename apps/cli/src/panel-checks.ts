import { isLoopbackHostname } from "@friday/api";
import { parseOrigins } from "./daemon-panel.ts";

/** Logged when an origin has no HTTPS outside loopback; never quotes the origin. */
export const INSECURE_ORIGIN_REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_ORIGINS tem uma origem sem HTTPS fora do loopback. Use https:// em toda origem que não seja 127.0.0.1, localhost ou [::1], e reinicie o daemon; o daemon continua rodando sem o painel.";

function isInsecure(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  return url.protocol !== "https:" && !isLoopbackHostname(url.hostname);
}

/** The refusal text when some origin is invalid or plain http outside loopback; null otherwise. */
export function panelRefusalOf(env: Record<string, string | undefined>): string | null {
  return parseOrigins(env.FRIDAY_PANEL_ORIGINS).some(isInsecure) ? INSECURE_ORIGIN_REFUSAL : null;
}
