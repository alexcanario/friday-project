import { hookNames } from "./git-cli-commit.ts";

/** Keys a mirror created by `git init --bare` may hold; every other local key is refused (fail closed). */
export const MIRROR_ALLOWED_KEYS = new Set([
  "core.repositoryformatversion",
  "core.filemode",
  "core.bare",
  "core.symlinks",
  "core.ignorecase",
  "core.logallrefupdates",
  "core.precomposeunicode",
  "extensions.refstorage",
  "extensions.objectformat",
]);

/** Runs git and returns stdout; throws when the exit code is not in `okCodes`. */
export type GitCapture = (args: string[], okCodes: number[]) => Promise<string>;

const keysOf = (stdout: string): string[] =>
  stdout
    .split("\n")
    .map((line) => line.replace(/\r$/, ""))
    .filter((line) => line !== "");

/**
 * Refuses a mirror whose local config has a key outside `MIRROR_ALLOWED_KEYS` and returns the names of
 * the config-defined hooks (from the global config too), so the caller can switch each one off.
 * Section and name come lowercase from git; the subsection keeps its case, so only the key is lowered.
 */
export async function guardMirror(capture: GitCapture, mirror: string): Promise<string[]> {
  let listed: string;
  try {
    listed = await capture(
      ["--git-dir", mirror, "config", "--local", "--name-only", "--list"],
      [0, 1],
    );
  } catch {
    throw new Error("A config do espelho não pôde ser lida.");
  }
  const denied = keysOf(listed).filter((key) => !MIRROR_ALLOWED_KEYS.has(key.toLowerCase()));
  if (denied.length > 0) {
    throw new Error(`A config do espelho tem chaves não permitidas: ${denied.join(", ")}.`);
  }
  const hooks = await capture(
    ["--git-dir", mirror, "config", "--name-only", "--get-regexp", "^hook\\."],
    [0, 1],
  );
  return hookNames(hooks);
}
