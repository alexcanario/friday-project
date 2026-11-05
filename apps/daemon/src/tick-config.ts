import { loadFactoryConfig } from "@friday/infrastructure";

export interface TickConfig {
  enabled: boolean;
  maxConcurrentRuns: number;
}

/** Reads `<root>/factory.yaml` on every call; `null` when the config is invalid. */
export function readTickConfig(root: string): TickConfig | null {
  const result = loadFactoryConfig(root);
  if (!result.ok) return null;
  return {
    enabled: result.config.enabled,
    maxConcurrentRuns: result.config.limits.max_concurrent_runs ?? 1,
  };
}
