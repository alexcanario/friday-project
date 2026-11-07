import {
  buildEffectsRun,
  type AgentRunOptions,
  type AgentRunRequest,
  type EventStore,
  type QaStepInput,
  type StoredEvent,
} from "@friday/application";
import type { Criteria } from "@friday/contracts";
import type { IssueState } from "@friday/domain";
import { criteriaOf } from "./specialist-request.ts";

type AgentConfig = NonNullable<AgentRunRequest["friday"]>["agent"];

export type WorkReport = { worktreePath: string; headSha: string; changedFiles: string[] };

export type QaRequestInput = {
  issue: { number: number; title: string; body: string };
  criteria: Criteria["criteria"];
  report: WorkReport;
  screenPaths: string[];
  agent: AgentRunOptions;
  friday: {
    runId: string;
    agent: Pick<AgentConfig, "states" | "mcp_tools">;
    getIssueState: () => IssueState;
  };
  configRoot: string;
  branch: string;
  base: string;
  getPullRequest: () => number | null;
};

export type QaContext = Omit<QaRequestInput, "criteria" | "report">;

export type QaTargetDeps = {
  projectId: string;
  events: Pick<EventStore, "list">;
  context: (issueId: number, runId: string) => QaContext | null;
  log?: (message: string) => void;
};

const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** The payload of the latest WorkReported event (D69), or null when missing or invalid. */
export function workReportOf(events: StoredEvent[]): WorkReport | null {
  const latest = events
    .filter((e) => e.type === "WorkReported")
    .reduce<StoredEvent | null>((a, b) => (a === null || b.seq > a.seq ? b : a), null);
  const payload = latest?.payload;
  if (typeof payload !== "object" || payload === null) return null;
  const { worktreePath, headSha, changedFiles } = payload as Record<string, unknown>;
  if (typeof worktreePath !== "string" || worktreePath === "") return null;
  if (typeof headSha !== "string" || !SHA_PATTERN.test(headSha)) return null;
  if (!Array.isArray(changedFiles) || !changedFiles.every((f) => typeof f === "string"))
    return null;
  return { worktreePath, headSha, changedFiles };
}

function promptOf(input: QaRequestInput): string {
  const { issue, criteria, report } = input;
  const lines = criteria.map((c) => {
    const proof = c.proof.kind === "command" ? c.proof.command : c.proof.step;
    return `${c.index}. ${c.claim} [${c.proof.kind}: ${proof}]`;
  });
  const files =
    report.changedFiles.length === 0
      ? "nenhum"
      : report.changedFiles.map((f) => `\n- ${f}`).join("");
  return (
    `Issue #${issue.number}: ${issue.title}\n\n${issue.body}\n\n` +
    `Critérios de aceite:\n${lines.join("\n")}\n\n` +
    `Head SHA: ${report.headSha}\nArquivos mudados: ${files}`
  );
}

/** Builds the QA step input: prompt, run id and the effect tools' run. Throws for invalid input. */
export function buildQaStepInput(input: QaRequestInput): QaStepInput {
  const run = buildEffectsRun({
    issue: input.issue.number,
    role: "qa",
    branch: input.branch,
    base: input.base,
    worktree: input.report.worktreePath,
    getPullRequest: input.getPullRequest,
  });
  return {
    request: {
      cwd: input.report.worktreePath,
      configRoot: input.configRoot,
      prompt: promptOf(input),
      agent: input.agent,
      friday: { ...input.friday, effects: { run } },
    },
    headSha: input.report.headSha,
    criteria: input.criteria,
    changedFiles: input.report.changedFiles,
    screenPaths: input.screenPaths,
  };
}

/** The QA input of an issue from its recorded events, or null (logged) when anything is missing. Never throws. */
export function qaTargetOf(
  deps: QaTargetDeps,
): (issueId: number, runId: string) => QaStepInput | null {
  return (issueId, runId) => {
    try {
      const events = deps.events.list(deps.projectId, issueId);
      const report = workReportOf(events);
      if (report === null) {
        deps.log?.(`A issue ${issueId} em QA não tem WorkReported válido`);
        return null;
      }
      const criteria = criteriaOf(events);
      if (criteria === null || criteria.length === 0) {
        deps.log?.(`A issue ${issueId} em QA não tem CriteriaSet válido`);
        return null;
      }
      const context = deps.context(issueId, runId);
      if (context === null) {
        deps.log?.(`A issue ${issueId} em QA não tem contexto para o QA`);
        return null;
      }
      return buildQaStepInput({ ...context, criteria, report });
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error);
      deps.log?.(`Falha ao montar a entrada do QA da issue ${issueId}: ${text}`);
      return null;
    }
  };
}
