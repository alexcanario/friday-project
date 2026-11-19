import { hostsFile, type HostEntry } from "@friday/contracts";

const INVALID = "Lista de hosts inválida.";

/** Reads `hosts.json` next to the build (relative path) and validates it. */
export async function loadHosts(): Promise<HostEntry[]> {
  const res = await fetch("hosts.json");
  if (!res.ok) throw new Error(INVALID);
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    throw new Error(INVALID);
  }
  const parsed = hostsFile.safeParse(body);
  if (!parsed.success) throw new Error(INVALID);
  return parsed.data;
}
