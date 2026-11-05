const META = /[;&|<>`\n\r]|\$\(|\$[{A-Za-z]/;
const BLOCKED_WORDS = new Set(["gh", "curl"]);

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "s");
}

function hasBlockedWord(command: string): boolean {
  const tokens = command.split(/\s+/).filter((t) => t !== "");
  if (tokens.some((t) => BLOCKED_WORDS.has(t))) return true;
  const git = tokens.indexOf("git");
  return git !== -1 && tokens.slice(git + 1).includes("push");
}

/** Deny-by-default check of a Bash command against the `bash_allow` globs. */
export function isBashAllowed(command: string, bashAllow: readonly string[]): boolean {
  if (bashAllow.length === 0) return false;
  if (META.test(command) || hasBlockedWord(command)) return false;
  return bashAllow.some((glob) => globToRegExp(glob).test(command));
}
