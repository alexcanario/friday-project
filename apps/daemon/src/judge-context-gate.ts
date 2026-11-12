import { judgeContextOf } from "./judge-context.ts";
import type { JudgeDispatchDeps } from "./judge-dispatch.ts";
import { judgeRedactorOf } from "./redact.ts";
import { applyInput } from "./run-recorder.ts";

type GateDeps = Pick<JudgeDispatchDeps, "projectId" | "recorder" | "step" | "log">;

/**
 * The Judge context of the head, or null after holding the issue with JudgeContextMissing (fail
 * closed, D104, D106). When the hold is refused it records JudgeSkipped so the head is not retried.
 */
export function contextOrHold(deps: GateDeps, issueId: number, head: string): string | null {
  const events = deps.recorder.events.list(deps.projectId, issueId);
  const context = judgeContextOf(events, head, judgeRedactorOf(deps.step.env, deps.step.review));
  if (context !== null) return context;
  deps.log?.(
    `O Judge da issue ${issueId} não roda: faltam os critérios ou o relatório do QA do head ${head}`,
  );
  const held = applyInput(
    deps.recorder,
    { issueId, runId: null },
    { type: "RunHeld", reason: "JudgeContextMissing" },
  );
  if (held) {
    deps.log?.(
      `A issue ${issueId} ficou retida (JudgeContextMissing). Depois de refazer o QA, use: friday resume ${issueId}`,
    );
    return null;
  }
  deps.recorder.events.append({
    projectId: deps.projectId,
    issueId,
    runId: null,
    type: "JudgeSkipped",
    payload: { reason: "context_missing", headSha: head },
    actor: "daemon",
    at: deps.recorder.now().toISOString(),
  });
  return null;
}
