import { isAbsolute } from "node:path";
import { isInside, resolveReal } from "@friday/infrastructure";
import type { RunRecorderDeps } from "./run-recorder.ts";
import type { VerifyApplyResult } from "./verify-apply.ts";
import { runVerifyForIssue } from "./verify-dispatch.ts";
import { runVerifyStep, type VerifyStepInput, type VerifyStepOutcome } from "./verify-step.ts";

export type VerifyBranchDeps = {
  projectId: string;
  recorder: RunRecorderDeps;
  root: string;
  /** Directory the worktreePath must stay inside; defaults to `root`. */
  worktreesRoot?: string;
  env: Record<string, string | undefined>;
  readHead?: (cwd: string) => Promise<string>;
  log?: (message: string) => void;
};

/** True when `path` is absolute and strictly below `root`, following symbolic links. */
export function isInsideRoot(root: string, path: string): boolean {
  return isAbsolute(path) && isInside(root, path) && resolveReal(path) !== resolveReal(root);
}

/** Builds the Verify branch of the dispatcher; refuses a worktree outside the daemon root. */
export function createVerifyBranch(
  deps: VerifyBranchDeps,
): (issueId: number) => Promise<VerifyApplyResult> {
  const step = (input: VerifyStepInput): Promise<VerifyStepOutcome> => {
    if (!isInsideRoot(deps.worktreesRoot ?? deps.root, input.worktreePath)) {
      deps.log?.(`O worktreePath ${input.worktreePath} está fora da raiz do daemon`);
      return Promise.resolve({ input: { type: "RunHeld", reason: "RunMisconfigured" } });
    }
    return runVerifyStep(
      {
        registryRoot: deps.root,
        env: deps.env,
        ...(deps.readHead === undefined ? {} : { readHead: deps.readHead }),
      },
      input,
    );
  };
  return (issueId) =>
    runVerifyForIssue(
      {
        projectId: deps.projectId,
        recorder: deps.recorder,
        step,
        ...(deps.log === undefined ? {} : { log: deps.log }),
      },
      issueId,
    );
}
