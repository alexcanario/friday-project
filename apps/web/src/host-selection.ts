import type { HostEntry } from "@friday/contracts";

export type Selection =
  | { kind: "none" }
  | { kind: "selected"; host: HostEntry; project: string }
  | { kind: "unknown-host"; host: string };

/** Reads `?host=<name>&project=<owner/repo>`; a missing host or project means no selection. */
export function selectionFromSearch(search: string, hosts: HostEntry[]): Selection {
  const params = new URLSearchParams(search);
  const name = params.get("host");
  const project = params.get("project");
  if (name === null || name === "" || project === null || project === "") return { kind: "none" };
  const host = hosts.find((h) => h.name === name);
  return host === undefined
    ? { kind: "unknown-host", host: name }
    : { kind: "selected", host, project };
}

export function selectionToSearch(host: string, project: string): string {
  return `?${new URLSearchParams({ host, project }).toString()}`;
}
