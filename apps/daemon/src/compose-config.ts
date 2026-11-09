import { loadFactoryConfig } from "@friday/infrastructure";
import type { Repo } from "./compose-branches.ts";
import type { ComposeOptions } from "./compose.ts";
import type { DispatchConfig } from "./state-dispatcher.ts";
import { readTickConfig, type TickConfig } from "./tick-config.ts";

/** Reads `<root>/factory.yaml` on every call; `null` when the config is invalid or missing. */
export function readDispatchConfig(root: string): DispatchConfig | null {
  const result = loadFactoryConfig(root);
  if (!result.ok) return null;
  return {
    risk: result.config.risk,
    mergeMode: result.config.pull_requests.merge,
    screenPaths: result.config.flow.screen_paths,
  };
}

/** Refuses to start with `max_concurrent_runs` above 1 (D72); a missing or invalid file is left to `readAuthor`. */
export function assertSingleConcurrentRun(root: string): void {
  const config = readTickConfig(root);
  if (config === null || config.maxConcurrentRuns <= 1) return;
  throw new Error(
    `limits.max_concurrent_runs = ${config.maxConcurrentRuns} não é aceito: a conferência de teto ainda não reserva as runs ativas; use 1 ou omita a opção (D72).`,
  );
}

/** Tick config that dispatches nothing (`null`) and logs while `max_concurrent_runs` is above 1 (D74). */
export function readGuardedTickConfig(
  root: string,
  log?: (message: string) => void,
): TickConfig | null {
  const config = readTickConfig(root);
  if (config === null || config.maxConcurrentRuns <= 1) return config;
  log?.(
    `limits.max_concurrent_runs = ${config.maxConcurrentRuns} não é aceito: nenhuma run será despachada neste tick; use 1 ou omita a opção (D74).`,
  );
  return null;
}

/** Reads the author token by variable name only (D56); fails closed. */
export function readAuthor(opts: ComposeOptions): {
  token: string;
  tokenEnv: string;
  tokenEnvNames: string[];
  repo: Repo;
  repository: { owner: string; name: string };
} {
  const loaded = loadFactoryConfig(opts.root);
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const name = loaded.config.pull_requests.author_token_env;
  if (name === undefined)
    throw new Error("A configuração não define pull_requests.author_token_env.");
  const token = opts.env[name];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${name} está vazia ou ausente.`);
  const { owner, name: repo } = loaded.config.repository;
  const review = loaded.config.pull_requests.review_token_env;
  const tokenEnvNames = review === undefined ? [name] : [name, review];
  return {
    token,
    tokenEnv: name,
    tokenEnvNames,
    repo: { owner, repo },
    repository: { owner, name: repo },
  };
}
