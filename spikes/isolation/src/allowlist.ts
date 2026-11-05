// Exact host match only: no wildcards, no suffix matching.
export function isAllowed(host: string, allowlist: string[]): boolean {
  const name = host.trim().toLowerCase().replace(/:\d+$/, "");
  return allowlist.some((entry) => entry.trim().toLowerCase() === name);
}
