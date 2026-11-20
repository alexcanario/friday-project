/** The panel token lives only in `sessionStorage`, one key per host. */
export function tokenKey(host: string): string {
  return `friday.panelToken.${host}`;
}

export function readToken(host: string): string {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(tokenKey(host)) ?? "";
}

const listeners = new Set<() => void>();
let version = 0;

/** Calls `listener` after every saved token; returns the function that stops it. */
export function subscribeToken(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

/** Goes up by one on every saved token. */
export function tokenVersion(): number {
  return version;
}

export function saveToken(host: string, token: string): void {
  sessionStorage.setItem(tokenKey(host), token);
  version += 1;
  for (const listener of [...listeners]) listener();
}

/** Hands the typed token to `onSave` and returns the cleared field value. */
export function saveTyped(typed: string, onSave: (value: string) => void): string {
  onSave(typed);
  return "";
}

/** Saves the typed token; false when it is empty. */
export function submitToken(host: string, value: string): boolean {
  saveToken(host, value);
  return value !== "";
}
