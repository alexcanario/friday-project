import {
  buildEffectsRun,
  type AgentRunOptions,
  type AgentRunRequest,
  type StoredEvent,
} from "@friday/application";
import { criteriaSchema, type Criteria } from "@friday/contracts";
import type { IssueState } from "@friday/domain";

type AgentConfig = NonNullable<AgentRunRequest["friday"]>["agent"];

export type SpecialistRequestInput = {
  issue: { number: number; title: string; body: string };
  criteria: Criteria["criteria"] | null;
  feedback: string | null;
  agent: AgentRunOptions;
  friday: { runId: string; agent: AgentConfig; getIssueState: () => IssueState };
  cwd: string;
  configRoot: string;
  branch: string;
  base: string;
  getPullRequest: () => number | null;
};

function promptOf(input: SpecialistRequestInput): string {
  const { issue, criteria, feedback } = input;
  let prompt = `Issue #${issue.number}: ${issue.title}\n\n${issue.body}`;
  if (criteria !== null) {
    const lines = criteria.map((c) => {
      const proof = c.proof.kind === "command" ? c.proof.command : c.proof.step;
      return `${c.index}. ${c.claim} [${c.proof.kind}: ${proof}]`;
    });
    prompt += `\n\nCritérios de aceite:\n${lines.join("\n")}`;
  }
  if (feedback !== null) prompt += `\n\nFeedback da rodada anterior:\n${feedback}`;
  return prompt;
}

/** Builds the specialist run request: prompt, run id and the effect tools' run. Throws for invalid input. */
export function buildSpecialistRequest(input: SpecialistRequestInput): AgentRunRequest {
  const run = buildEffectsRun({
    issue: input.issue.number,
    role: "specialist",
    branch: input.branch,
    base: input.base,
    worktree: input.cwd,
    getPullRequest: input.getPullRequest,
  });
  return {
    cwd: input.cwd,
    configRoot: input.configRoot,
    prompt: promptOf(input),
    agent: input.agent,
    friday: { ...input.friday, runId: input.friday.runId, effects: { run } },
  };
}

const latest = (events: StoredEvent[], types: string[], after = 0): StoredEvent | null =>
  events
    .filter((e) => types.includes(e.type) && e.seq > after)
    .reduce<StoredEvent | null>((a, b) => (a === null || b.seq > a.seq ? b : a), null);

/** The criteria of the latest valid CriteriaSet event, or null. */
export function criteriaOf(events: StoredEvent[]): Criteria["criteria"] | null {
  const valid = events
    .filter((e) => e.type === "CriteriaSet" && criteriaSchema.safeParse(e.payload).success)
    .sort((a, b) => b.seq - a.seq)[0];
  if (valid === undefined) return null;
  const parsed = criteriaSchema.safeParse(valid.payload);
  return parsed.success ? parsed.data.criteria : null;
}

/** The feedback of the latest QA, Judge or Verify result after the last WorkReported, or null. */
export function feedbackOf(events: StoredEvent[]): string | null {
  const work = latest(events, ["WorkReported"]);
  const found = latest(events, ["QaFinished", "JudgeFinished", "VerifyFinished"], work?.seq ?? 0);
  const feedback = (found?.payload as { feedback?: unknown } | undefined)?.feedback;
  return typeof feedback === "string" ? feedback : null;
}
