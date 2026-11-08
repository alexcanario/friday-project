import { toAgentRunOptions, type StoredEvent } from "@friday/application";
import { createPrOf, type QaCompose, type QaReadPort } from "@friday/daemon";
import { branchName, type loadFactoryConfig } from "@friday/infrastructure";

type Loaded = Extract<ReturnType<typeof loadFactoryConfig>, { ok: true }>;
type Context = NonNullable<ReturnType<QaCompose["context"]>>;

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value !== "";

/** Title and body of the latest IssueIngested event; null when missing or empty (fails closed). */
function ingestedOf(events: StoredEvent[]): { title: string; body: string } | null {
  const latest = events
    .filter((e) => e.type === "IssueIngested")
    .reduce<StoredEvent | null>((a, b) => (a === null || b.seq > a.seq ? b : a), null);
  const payload = latest?.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const { title, body } = payload as Record<string, unknown>;
  return nonEmpty(title) && nonEmpty(body) ? { title, body } : null;
}

function contextOf(loaded: Loaded) {
  return (issueId: number, runId: string, read: QaReadPort): Context | null => {
    const ingested = ingestedOf(read.events.list(read.projectId, issueId));
    if (ingested === null) return null;
    if (read.issues.get(read.projectId, issueId) === null) return null;
    return {
      issue: { number: issueId, title: ingested.title, body: ingested.body },
      branch: branchName(issueId, ingested.title),
      base: loaded.config.repository.base,
      screenPaths: loaded.config.flow.screen_paths,
      getPullRequest: createPrOf(read.events, read.projectId).bind(null, issueId),
      friday: {
        runId,
        agent: { states: ["QA"], mcp_tools: [] },
        getIssueState: () =>
          read.issues.get(read.projectId, issueId)?.state as ReturnType<
            Context["friday"]["getIssueState"]
          >,
      },
    };
  };
}

/** The qa card of the central registry plus the per-issue context (D79); it fails closed (null). */
export function qaComposeOf(loaded: Loaded): QaCompose | null {
  const card = loaded.agents["qa"];
  if (card === undefined) return null;
  return { agent: toAgentRunOptions(card), context: contextOf(loaded) };
}
