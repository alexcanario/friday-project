/** The run an agent's effect tools act on; same shape as `EffectsInput["run"]` in infrastructure. */
export interface EffectsRun {
  issue: number;
  role: string;
  branch: string;
  base: string;
  worktree: string;
  getPullRequest: () => number | null;
  /** Set by the daemon per run; called once `pr_create` has opened or found the PR. */
  onPrCreated?: (pr: number) => void;
}

/** Validates and returns the run for the effect tools. Pure, no I/O. */
export function buildEffectsRun(input: EffectsRun): EffectsRun {
  if (!Number.isInteger(input.issue) || input.issue <= 0) {
    throw new Error("O número da issue deve ser um inteiro positivo.");
  }
  for (const field of ["role", "branch", "base", "worktree"] as const) {
    if (input[field] === "") throw new Error(`O campo ${field} da run não pode ser vazio.`);
  }
  if (input.branch === input.base) {
    throw new Error("A branch da run não pode ser igual à branch base.");
  }
  if (!new RegExp(`^friday/${input.issue}(-[a-z0-9-]+)?$`).test(input.branch)) {
    throw new Error(`A branch da run deve seguir o formato friday/${input.issue}[-slug].`);
  }
  return {
    issue: input.issue,
    role: input.role,
    branch: input.branch,
    base: input.base,
    worktree: input.worktree,
    getPullRequest: input.getPullRequest,
  };
}
