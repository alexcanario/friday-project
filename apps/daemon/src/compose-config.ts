import { assertPrivateKeyReadable, loadFactoryConfig } from "@friday/infrastructure";
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

type Repository = { owner: string; name: string };

export type Author =
  | {
      mode: "env";
      token: string;
      tokenEnv: string;
      tokenEnvNames: string[];
      repo: Repo;
      repository: Repository;
    }
  | {
      mode: "app";
      app: { appId: number; installationId: number; privateKeyPath: string };
      tokenEnvNames: string[];
      repo: Repo;
      repository: Repository;
    };

/** Reads the author credential: a token by variable name only (D56) or the App ids (D89); fails closed. */
export function readAuthor(opts: ComposeOptions): Author {
  const loaded = loadFactoryConfig(opts.root);
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const { owner, name: repoName } = loaded.config.repository;
  const common = { repo: { owner, repo: repoName }, repository: { owner, name: repoName } };
  const pr = loaded.config.pull_requests;
  const review = pr.review_token_env;
  if (pr.author_app !== undefined) {
    const { app_id: appId, installation_id: installationId, private_key_path } = pr.author_app;
    return {
      mode: "app",
      app: { appId, installationId, privateKeyPath: private_key_path },
      tokenEnvNames: review === undefined ? [] : [review],
      ...common,
    };
  }
  const name = pr.author_token_env;
  if (name === undefined)
    throw new Error("A configuração não define pull_requests.author_token_env.");
  const token = opts.env[name];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${name} está vazia ou ausente.`);
  return {
    mode: "env",
    token,
    tokenEnv: name,
    tokenEnvNames: review === undefined ? [name] : [name, review],
    ...common,
  };
}

/** Fails at startup when an App private key file is unreadable (author and, if set, review). */
export function assertAppKeysReadable(root: string, author: Author): void {
  if (author.mode !== "app") return;
  assertPrivateKeyReadable(author.app.privateKeyPath, "pull_requests.author_app");
  const loaded = loadFactoryConfig(root);
  const review = loaded.ok ? loaded.config.pull_requests.review_app : undefined;
  if (review !== undefined)
    assertPrivateKeyReadable(review.private_key_path, "pull_requests.review_app");
}
