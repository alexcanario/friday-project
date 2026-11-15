export function projectFromSearch(search: string): string | undefined {
  return new URLSearchParams(search).get("project") || undefined;
}
