import { resolve } from "node:path";
import { buildApp, type ApiDeps } from "./app.ts";
import { DEFAULT_ATTEMPT_LIMIT, type AttemptLimit } from "./attempt-limit.ts";
import { allowedHostsOf } from "./host-check.ts";

export const DEFAULT_PORT = 7777;
const HOST = "127.0.0.1";
export const DEFAULT_WEB_ROOT = resolve(import.meta.dirname, "../../web/dist");

export interface StartApiOptions {
  deps: ApiDeps;
  port?: number;
  webRoot?: string;
  allowedOrigins?: readonly string[];
  /** Defaults to `DEFAULT_ATTEMPT_LIMIT`: the daemon always has the limit. */
  attemptLimit?: AttemptLimit;
}

export interface RunningApi {
  address: string;
  port: number;
  close(): Promise<void>;
}

export async function startApi(options: StartApiOptions): Promise<RunningApi> {
  let boundPort = options.port ?? DEFAULT_PORT;
  const app = await buildApp(options.deps, {
    webRoot: options.webRoot ?? DEFAULT_WEB_ROOT,
    allowedOrigins: options.allowedOrigins,
    attemptLimit: options.attemptLimit ?? DEFAULT_ATTEMPT_LIMIT,
    allowedHosts: () => allowedHostsOf(boundPort, options.allowedOrigins ?? []),
  });
  await app.listen({ host: HOST, port: boundPort });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  boundPort = port;
  return { address: HOST, port, close: () => app.close() };
}
