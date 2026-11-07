import { loadFactoryConfig } from "@friday/infrastructure";
import type { DispatchConfig } from "./state-dispatcher.ts";

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
