import type { SpecialistStepOutcome } from "@friday/application";

/** Reads the heads the specialist dispatch compares before and after a run without push (D107). */
export type SpecialistHeadDeps = {
  /** Current head of the PR on the remote. */
  prHead: (pr: number) => Promise<string>;
  /** HEAD of the issue's worktree; null when the worktree is not listed. */
  worktreeHead: (issueId: number) => Promise<string | null>;
  /** True when the worktree has no changes and `head` is its HEAD. */
  isClean: (path: string, head: string) => Promise<boolean>;
};

export type HeadFallback = { ok: true; head: string | null } | { ok: false; reason: string };

/** Without a PR there is no fallback; with one, the worktree must already be at the PR head. */
export async function resolveHeadFallback(
  deps: SpecialistHeadDeps,
  issueId: number,
  pr: number | null,
): Promise<HeadFallback> {
  if (pr === null) return { ok: true, head: null };
  try {
    const [remote, local] = await Promise.all([deps.prHead(pr), deps.worktreeHead(issueId)]);
    if (local === null) return { ok: false, reason: "a worktree da issue não foi encontrada" };
    if (local !== remote) {
      return {
        ok: false,
        reason: `a worktree (${local}) não está no head do PR ${pr} (${remote})`,
      };
    }
    return { ok: true, head: remote };
  } catch (error) {
    return { ok: false, reason: `falha ao ler o head do PR ${pr}: ${String(error)}` };
  }
}

export const HELD_BEFORE_RUN: SpecialistStepOutcome = {
  inputs: [{ type: "RunHeld", reason: "RuntimeFailed" }],
  violations: [],
};

/**
 * A report whose head is the fallback means the agent did not push: the report only stands when the
 * worktree is clean, otherwise the QA would review a head without the agent's edits.
 */
export async function guardNoPush(
  deps: SpecialistHeadDeps,
  cwd: string,
  headFallback: string | null | undefined,
  outcome: SpecialistStepOutcome,
): Promise<SpecialistStepOutcome> {
  if (headFallback == null || !("report" in outcome)) return outcome;
  if (outcome.report.headSha !== headFallback) return outcome;
  const clean = await deps.isClean(cwd, headFallback).catch(() => false);
  if (clean) return outcome;
  return { inputs: [{ type: "RunHeld", reason: "SchemaInvalid" }], violations: [] };
}
