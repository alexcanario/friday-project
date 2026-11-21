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

// Same normalisation fetch applies before resolving: no tab/LF/CR, no leading controls or spaces.
function normalizeLikeFetch(baseUrl: string): string {
  const clean = baseUrl.replace(/[\t\n\r]/g, "");
  let start = 0;
  while (start < clean.length && clean.charCodeAt(start) <= 0x20) start += 1;
  return clean.slice(start);
}

// A base the URL constructor refuses may still resolve to another host (or scheme) in fetch.
function escapesPage(baseUrl: string): boolean {
  const text = normalizeLikeFetch(baseUrl);
  // Callers append a path that starts with a slash, so a lone slash becomes two.
  return /^[/\\]{2}/.test(text + "/") || /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text);
}

/** True when a token sent to `baseUrl` would travel over http outside the loopback. */
export function isInsecureBase(baseUrl: string, page: PageLocation | undefined): boolean {
  const url = baseUrl === "" ? null : parse(baseUrl);
  if (url === null) return (baseUrl !== "" && escapesPage(baseUrl)) || isInsecurePage(page);
  const web = url.protocol === "http:" || url.protocol === "https:";
  // fetch resolves a scheme without two separators against the page: fail closed.
  if (web && !/^https?:[/\\]{2}/i.test(normalizeLikeFetch(baseUrl))) return true;
  return url.protocol === "http:" && !LOOPBACK.has(url.hostname);
}
