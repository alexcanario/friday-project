export const CONTEXT_AREAS = ["backend", "frontend"] as const;

export type ContextArea = (typeof CONTEXT_AREAS)[number];

function areaOf(path: string): ContextArea | null {
  if (path.endsWith(".razor") || path.endsWith(".razor.cs")) return "frontend";
  if (path.endsWith(".cs")) return "backend";
  return null;
}

/** Areas touched by the paths, unique and in `CONTEXT_AREAS` order; other files are ignored. */
export function selectContextPackAreas(paths: readonly string[]): ContextArea[] {
  const found = new Set<ContextArea>();
  for (const path of paths) {
    const area = areaOf(path);
    if (area) found.add(area);
  }
  return CONTEXT_AREAS.filter((area) => found.has(area));
}
