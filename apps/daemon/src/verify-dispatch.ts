import type { StoredEvent } from "@friday/application";
import { applyVerifyOutcome, type VerifyApplyResult } from "./verify-apply.ts";
import { snapshotOf, type RunRecorderDeps } from "./run-recorder.ts";
import type { VerifyStepInput, VerifyStepOutcome } from "./verify-step.ts";

export type VerifyDispatchDeps = {
  projectId: string;
  recorder: RunRecorderDeps;
  step: (input: VerifyStepInput) => Promise<VerifyStepOutcome>;
  log?: (message: string) => void;
};

const NOT_APPLIED: VerifyApplyResult = { applied: false, feedback: null };
const SHA_PATTERN = /^[0-9a-f]{40}$/;

/** The input of the Verify step from the latest WorkReported event (D69), or null when invalid. */
export function verifyTargetOf(events: StoredEvent[]): VerifyStepInput | null {
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
  return { worktreePath, headSha };
}

async function execute(deps: VerifyDispatchDeps, issueId: number): Promise<VerifyApplyResult> {
  const { recorder } = deps;
  const row = recorder.issues.get(deps.projectId, issueId);
  const snapshot = row === null ? null : snapshotOf(row);
  if (snapshot === null || snapshot.state !== "Verify") {
    deps.log?.(`A issue ${issueId} não está em Verify`);
    return NOT_APPLIED;
  }
  const target = verifyTargetOf(recorder.events.list(deps.projectId, issueId));
  if (target === null) {
    deps.log?.(`A issue ${issueId} em Verify não tem WorkReported válido`);
    return NOT_APPLIED;
  }
  const outcome = await deps.step(target);
  const result = applyVerifyOutcome(recorder, { issueId, runId: null }, outcome);
  if (result.applied && outcome.input.type === "RunHeld" && "detail" in outcome) {
    deps.log?.(`A issue ${issueId} foi retida em Verify: ${outcome.detail}`);
  }
  if (result.applied && outcome.input.type === "VerifyFailed") {
    recorder.events.append({
      projectId: deps.projectId,
      issueId,
      runId: null,
      type: "VerifyFinished",
      payload: { outcome: "verify_failed", feedback: result.feedback },
      actor: "daemon",
      at: recorder.now().toISOString(),
    });
  }
  return result;
}

/** Runs the Verify step for an issue in Verify and applies the outcome. Never rejects. */
export async function runVerifyForIssue(
  deps: VerifyDispatchDeps,
  issueId: number,
): Promise<VerifyApplyResult> {
  try {
    return await execute(deps, issueId);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    deps.log?.(`Falha no Verify da issue ${issueId}: ${text}`);
    return NOT_APPLIED;
  }
}

/** Runs `verify` unless the issue is already running or the capacity is used up. */
export async function runGuardedVerify(
  verify: (issueId: number) => Promise<VerifyApplyResult>,
  running: Set<number>,
  usedSlots: number,
  capacity: { active: number; max: number } | undefined,
  issueId: number,
  log: (message: string) => void,
): Promise<void> {
  if (running.has(issueId)) return;
  if (capacity !== undefined && capacity.active + usedSlots >= capacity.max) return;
  running.add(issueId);
  try {
    await verify(issueId);
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    log(`Falha ao rodar o Verify da issue ${issueId}: ${text}`);
  } finally {
    running.delete(issueId);
  }
}
