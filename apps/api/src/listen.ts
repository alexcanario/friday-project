import { buildApp, type ApiDeps } from "./app.ts";

export const DEFAULT_PORT = 7777;
const HOST = "127.0.0.1";

export interface StartApiOptions {
  deps: ApiDeps;
  port?: number;
}

export interface RunningApi {
  address: string;
  port: number;
  close(): Promise<void>;
}

export async function startApi(options: StartApiOptions): Promise<RunningApi> {
  const app = await buildApp(options.deps);
  await app.listen({ host: HOST, port: options.port ?? DEFAULT_PORT });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr !== null ? addr.port : 0;
  return { address: HOST, port, close: () => app.close() };
}
