import type { HostEntry } from "@friday/contracts";

export type Selection =
  | { kind: "none" }
  | { kind: "selected"; host: HostEntry; project: string; run?: string }
  | { kind: "unknown-host"; host: string };

/** Reads `?host=<name>&project=<owner/repo>`; a missing host or project means no selection. */
export function selectionFromSearch(search: string, hosts: HostEntry[]): Selection {
  const params = new URLSearchParams(search);
  const name = params.get("host");
  const project = params.get("project");
  if (name === null || name === "" || project === null || project === "") return { kind: "none" };
  const host = hosts.find((h) => h.name === name);
  if (host === undefined) return { kind: "unknown-host", host: name };
  const run = params.get("run");
  return run === null || run === ""
    ? { kind: "selected", host, project }
    : { kind: "selected", host, project, run };
}

export function runToSearch(host: string, project: string, run: string): string {
  return `?${new URLSearchParams({ host, project, run }).toString()}`;
}

export function selectionToSearch(host: string, project: string): string {
  return `?${new URLSearchParams({ host, project }).toString()}`;
}
