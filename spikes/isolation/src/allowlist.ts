// Exact host match only: no wildcards, no suffix matching.
export function isAllowed(host: string, allowlist: string[]): boolean {
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return allowlist.some((entry) => entry.trim().toLowerCase() === name);
}

// Port of a CONNECT target: 443 when absent, null when it is not a valid TCP port.
export function connectPort(raw: string | undefined): number | null {
  if (raw === undefined || raw === "") return 443;
  if (!/^\d+$/.test(raw)) return null;
  const port = Number(raw);
  return port >= 1 && port <= 65535 ? port : null;
}
