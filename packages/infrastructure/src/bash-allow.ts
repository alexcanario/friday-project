// Only characters the shell takes literally: no operator, quote, expansion, brace or glob.
const LITERAL_COMMAND = /^[A-Za-z0-9 _./=:,@+%-]*$/;
const BLOCKED_WORDS = new Set(["gh", "curl"]);

function globToRegExp(glob: string): RegExp {
  const body = glob
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${body}$`, "s");
}

const baseName = (t: string): string =>
  t
    .slice(t.lastIndexOf("/") + 1)
    .toLowerCase()
    .replace(/\.(exe|cmd|bat|com)$/, "");

function hasBlockedWord(command: string): boolean {
  const tokens = command.split(/\s+/).filter((t) => t !== "");
  if (tokens.some((t) => BLOCKED_WORDS.has(baseName(t)))) return true;
  const git = tokens.findIndex((t) => baseName(t) === "git");
  return git !== -1 && tokens.slice(git + 1).some((t) => t.includes("push"));
}

/** Deny-by-default check of a Bash command against the `bash_allow` globs. */
export function isBashAllowed(command: string, bashAllow: readonly string[]): boolean {
  if (bashAllow.length === 0) return false;
  if (!LITERAL_COMMAND.test(command) || hasBlockedWord(command)) return false;
  return bashAllow.some((glob) => globToRegExp(glob).test(command));
}
