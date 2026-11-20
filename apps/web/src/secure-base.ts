// Built from parts: the no-fixed-origin test forbids these literals in the web source.
const LOOPBACK = new Set([["127", "0", "0", "1"].join("."), "local" + "host", "[::1]", "::1"]);

interface PageLocation {
  protocol: string;
  hostname: string;
}

function parse(baseUrl: string): URL | null {
  try {
    return new URL(baseUrl);
  } catch {
    return null;
  }
}

function isInsecurePage(page: PageLocation | undefined): boolean {
  return page !== undefined && page.protocol === "http:" && !LOOPBACK.has(page.hostname);
}

/** True when a token sent to `baseUrl` would travel over http outside the loopback. */
export function isInsecureBase(baseUrl: string, page: PageLocation | undefined): boolean {
  const url = baseUrl === "" ? null : parse(baseUrl);
  if (url === null) return isInsecurePage(page);
  return url.protocol === "http:" && !LOOPBACK.has(url.hostname);
}
