import type { Selection } from "./host-selection.ts";
import { isInsecureBase } from "./secure-base.ts";
import { readToken } from "./token.ts";

export interface LiveTarget {
  baseUrl: string;
  project: string;
  token: string;
  host: string;
}

/** The stream of the selected host; its token only ever travels with that host's `baseUrl`. */
export function liveTarget(selection: Selection): LiveTarget | null {
  if (selection.kind !== "selected") return null;
  const token = readToken(selection.host.name);
  if (token !== "" && isInsecureBase(selection.host.baseUrl, globalThis.location)) return null;
  return {
    baseUrl: selection.host.baseUrl,
    project: selection.project,
    token,
    host: selection.host.name,
  };
}
