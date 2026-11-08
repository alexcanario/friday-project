/** Worktree directory key for a project id: `<owner>/<repo>` becomes `<owner>__<repo>` (D74). */
export function worktreeKeyOf(projectId: string): string {
  return projectId.replaceAll("/", "__");
}
