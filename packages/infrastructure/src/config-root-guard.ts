import { realpathSync } from "node:fs";
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from "node:path";

/**
 * Resolves a path walking one segment at a time: existing parts go through realpath
 * (links and `..` after a link behave like the file system), the rest is completed lexically.
 */
export function resolveReal(path: string): string {
  const absolute = isAbsolute(path) ? path : resolve(path);
  const { root } = parse(absolute);
  let current = root;
  for (const segment of absolute.slice(root.length).split(/[\\/]+/)) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      current = dirname(current);
      continue;
    }
    const next = join(current, segment);
    try {
      current = realpathSync(next);
    } catch {
      current = next;
    }
  }
  return current;
}

/** True when `child` is `parent` or lies below it, comparing real paths. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(resolveReal(parent), resolveReal(child));
  if (rel === "") return true;
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}
