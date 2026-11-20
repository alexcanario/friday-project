import type { HostEntry } from "@friday/contracts";
import { createApiClient, type ApiClient } from "./api.ts";
import { readToken } from "./token.ts";

/** The only place that joins a host's base URL with that host's own token. */
export function defaultClientFor(host: HostEntry): ApiClient {
  return createApiClient(host.baseUrl, () => readToken(host.name));
}
