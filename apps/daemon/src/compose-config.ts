import { loadFactoryConfig } from "@friday/infrastructure";
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
