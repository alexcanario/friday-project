import type { ContextArea } from "@friday/application";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Text of `context-packs/<area>.md` in the registry, or null when it is missing or unreadable. */
export function readContextPack(registryRoot: string, area: ContextArea): string | null {
  try {
    return readFileSync(join(registryRoot, "context-packs", `${area}.md`), "utf8");
  } catch {
    return null;
  }
}
