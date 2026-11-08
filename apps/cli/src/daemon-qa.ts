import { toAgentRunOptions } from "@friday/application";
import type { QaCompose } from "@friday/daemon";
import type { loadFactoryConfig } from "@friday/infrastructure";

type Loaded = Extract<ReturnType<typeof loadFactoryConfig>, { ok: true }>;

/**
 * The qa card of the central registry plus the per-issue context.
 * The context fails closed (null) until issue title/body, branch, pull request and issue state
 * can be filled with real data (follow-up #294); no stubs with empty values.
 */
export function qaComposeOf(loaded: Loaded): QaCompose | null {
  const card = loaded.agents["qa"];
  if (card === undefined) return null;
  return { agent: toAgentRunOptions(card), context: () => null };
}
