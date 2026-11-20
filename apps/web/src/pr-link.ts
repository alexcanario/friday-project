const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/** Builds the GitHub PR URL; `null` unless `project` is `owner/repo` and `number` is a positive integer. */
export function prUrl(project: string, number: number): string | null {
  if (!Number.isInteger(number) || number <= 0) return null;
  const parts = project.split("/");
  if (parts.length !== 2) return null;
  const valid = parts.every((p) => SEGMENT.test(p) && p !== "." && p !== "..");
  return valid ? `https://github.com/${project}/pull/${number}` : null;
}
