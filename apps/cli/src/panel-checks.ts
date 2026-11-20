import { isLoopbackHostname, isPanelTokenFormatValid } from "@friday/api";

const DAY_MS = 86_400_000;
const MAX_EXPIRY_DAYS = 90;
const EXPIRY_SHAPE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Logged when an origin has no HTTPS outside loopback; never quotes the origin. */
export const INSECURE_ORIGIN_REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_ORIGINS tem uma origem sem HTTPS fora do loopback. Use https:// em toda origem que não seja 127.0.0.1, localhost ou [::1], e reinicie o daemon; o daemon continua rodando sem o painel.";

/** Logged when the token has characters outside A-Z, a-z, 0-9 or fewer than 32; never quotes it. */
export const INVALID_TOKEN_REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_TOKEN deve ter só letras e números (A-Z, a-z, 0-9) e pelo menos 32 caracteres. Gere outro valor e reinicie o daemon; o daemon continua rodando sem o painel.";

/** Logged when an origin outside loopback is set without the token expiry date. */
export const EXPIRY_REQUIRED_REFUSAL =
  "Painel não iniciado: com origem fora do loopback, FRIDAY_PANEL_TOKEN_EXPIRES_AT é obrigatória (data e hora UTC, por exemplo 2026-12-20T00:00:00Z). Defina e reinicie o daemon; o daemon continua rodando sem o painel.";

/** Logged when the token expiry date is malformed, impossible, past or more than 90 days ahead. */
export const EXPIRY_INVALID_REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_TOKEN_EXPIRES_AT deve ser uma data e hora UTC no formato AAAA-MM-DDTHH:MM:SSZ, no futuro e a no máximo 90 dias. Corrija e reinicie o daemon; o daemon continua rodando sem o painel.";

/** Splits `FRIDAY_PANEL_ORIGINS` by comma, trimming spaces and dropping empty items. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
}

/** The instant of a `AAAA-MM-DDTHH:MM:SSZ` value that is a real date; undefined otherwise (format only, no clock). */
export function parseExpiresAt(value: string | undefined): number | undefined {
  if (value === undefined || !EXPIRY_SHAPE.test(value)) return undefined;
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return undefined;
  return new Date(ms).toISOString().slice(0, 19) + "Z" === value ? ms : undefined;
}

function isInsecure(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return true;
  }
  return url.protocol !== "https:" && !isLoopbackHostname(url.hostname);
}

function isPublic(origin: string): boolean {
  try {
    return !isLoopbackHostname(new URL(origin).hostname);
  } catch {
    return true;
  }
}

/** The refusal text for the token, origins and expiry in `env`, checked in that order; null when none applies. */
export function panelRefusalOf(
  env: Record<string, string | undefined>,
  now: number,
): string | null {
  const token = env.FRIDAY_PANEL_TOKEN;
  if (token !== undefined && token !== "" && !isPanelTokenFormatValid(token)) {
    return INVALID_TOKEN_REFUSAL;
  }
  const origins = parseOrigins(env.FRIDAY_PANEL_ORIGINS);
  if (origins.some(isInsecure)) return INSECURE_ORIGIN_REFUSAL;
  const raw = env.FRIDAY_PANEL_TOKEN_EXPIRES_AT;
  if (raw === undefined || raw === "") {
    return origins.some(isPublic) ? EXPIRY_REQUIRED_REFUSAL : null;
  }
  const expiresAt = parseExpiresAt(raw);
  if (expiresAt === undefined || expiresAt <= now || expiresAt > now + MAX_EXPIRY_DAYS * DAY_MS) {
    return EXPIRY_INVALID_REFUSAL;
  }
  return null;
}

/** The warning line when the token expires in 7 days or less; null otherwise. */
export function expiryWarningOf(
  env: Record<string, string | undefined>,
  now: number,
): string | null {
  const expiresAt = parseExpiresAt(env.FRIDAY_PANEL_TOKEN_EXPIRES_AT);
  if (expiresAt === undefined || expiresAt - now > 7 * DAY_MS) return null;
  const days = Math.ceil((expiresAt - now) / DAY_MS);
  return `Aviso: FRIDAY_PANEL_TOKEN expira em ${days} dia(s). Gere outro token e reinicie o daemon.`;
}
