/** The panel token lives only in `sessionStorage`, one key per host. */
export function tokenKey(host: string): string {
  return `friday.panelToken.${host}`;
}

export function readToken(host: string): string {
  if (typeof sessionStorage === "undefined") return "";
  return sessionStorage.getItem(tokenKey(host)) ?? "";
}

export function saveToken(host: string, token: string): void {
  sessionStorage.setItem(tokenKey(host), token);
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
