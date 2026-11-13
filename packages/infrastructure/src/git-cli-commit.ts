import { lstat, mkdtemp, readFile, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve, sep } from "node:path";
import { execa } from "execa";

export const FRIDAY_AUTHOR = {
  name: "friday-author",
  email: "friday-author@users.noreply.github.com",
} as const;

export const HOOKS_OFF = "/dev/null";

const SHA_RE = /^[0-9a-f]{40}$/;
const HOOK_KEY_RE = /^hook\.(.+)\.[A-Za-z0-9-]+$/;
const FILTER_KEY_RE = /^filter\.(.+?)\.(?:clean|smudge|process|required)(?:\s|$)/;

/** Encodes config pairs as `GIT_CONFIG_COUNT/KEY_n/VALUE_n` environment variables. */
export function configEnv(pairs: [string, string][]): Record<string, string> {
  const out: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return out;
}

export interface CommitRequest {
  git: string;
  worktree: string;
  message: string;
  baseEnv: Record<string, string>;
  /** Test seam: runs right after the worktree is validated and before the first git step. */
  afterValidate?: () => Promise<void>;
}

/** The agent owns the worktree: `.git` must be a gitfile that points at a linked worktree dir. */
export async function assertLinkedWorktree(worktree: string): Promise<string> {
  const fail = (reason: string): never => {
    throw new Error(`Falha ao validar o worktree: ${reason}`);
  };
  const gitFile = join(worktree, ".git");
  const info = await lstat(gitFile).catch(() => undefined);
  if (info === undefined || !info.isFile()) fail("o .git do worktree não é um arquivo regular.");
  const match = /^gitdir: (.+?)\r?\n?$/.exec(await readFile(gitFile, "utf8"));
  if (match?.[1] === undefined) return fail("o .git do worktree não aponta para um diretório git.");
  const real = async (path: string): Promise<string> =>
    realpath(path).catch(() => fail("caminho do worktree não resolvido."));
  const gitDir = await real(resolve(worktree, match[1]));
  const root = await real(worktree);
  if (basename(dirname(gitDir)) !== "worktrees")
    fail("o .git do worktree não aponta para worktrees/<n>.");
  if (gitDir === root || gitDir.startsWith(root + sep)) fail("o gitdir está dentro do worktree.");
  const back = await readFile(join(gitDir, "gitdir"), "utf8").catch(() => "");
  if ((await real(resolve(gitDir, back.trim()))) !== join(root, ".git")) {
    fail("o gitdir não aponta de volta para este worktree.");
  }
  const common = await readFile(join(gitDir, "commondir"), "utf8").catch(() => "");
  if (
    common.trim() === "" ||
    (await real(resolve(gitDir, common.trim()))) !== dirname(dirname(gitDir))
  ) {
    fail("o commondir não pertence ao repositório do worktree.");
  }
  return gitDir;
}

export function filterDrivers(stdout: string): string[] {
  const names = new Set<string>();
  for (const line of stdout.split("\n")) {
    const name = FILTER_KEY_RE.exec(line)?.[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** Names of the config-defined hooks in the keys printed by `git config --name-only --get-regexp "^hook\."`. */
export function hookNames(stdout: string): string[] {
  const names = new Set<string>();
  for (const line of stdout.split("\n")) {
    const name = HOOK_KEY_RE.exec(line.replace(/\r$/, ""))?.[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/** Arguments of the one `git config` call that lists the filter drivers and the config-defined hooks. */
export const GUARD_CONFIG_ARGS = ["config", "--name-only", "--get-regexp", "^(filter|hook)\\."];

/** Filter drivers and hook names found in the output of `GUARD_CONFIG_ARGS`. */
export function guardsOf(stdout: string): { drivers: string[]; hooks: string[] } {
  return { drivers: filterDrivers(stdout), hooks: hookNames(stdout) };
}

/** Hardened environment of a git step run in an agent-owned worktree: explicit gitdir, no hooks, no filters. */
export function stepEnv(
  request: Pick<CommitRequest, "baseEnv" | "worktree">,
  gitDir: string,
  home: string,
  drivers: string[],
  hooks: string[] = [],
): Record<string, string> {
  const pairs: [string, string][] = [
    ["core.hooksPath", HOOKS_OFF],
    ["core.fsmonitor", "false"],
    ["commit.gpgSign", "false"],
    ["core.attributesFile", ""],
    ["gc.auto", "0"],
    ["maintenance.auto", "false"],
    ["core.autocrlf", "false"],
    ["core.safecrlf", "false"],
    ["core.eol", "lf"],
  ];
  for (const d of drivers) {
    pairs.push(
      [`filter.${d}.clean`, ""],
      [`filter.${d}.smudge`, ""],
      [`filter.${d}.process`, ""],
      [`filter.${d}.required`, "false"],
    );
  }
  for (const h of hooks) pairs.push([`hook.${h}.enabled`, "false"]);
  return {
    ...request.baseEnv,
    HOME: home,
    USERPROFILE: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_ATTR_NOSYSTEM: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_DIR: gitDir,
    GIT_WORK_TREE: request.worktree,
    ...configEnv(pairs),
  };
}

const identityArgs = (): string[] =>
  ["user", "author", "committer"].flatMap((scope) => [
    "-c",
    `${scope}.name=${FRIDAY_AUTHOR.name}`,
    "-c",
    `${scope}.email=${FRIDAY_AUTHOR.email}`,
  ]);

/** Commits the pending worktree changes (if any) as friday-author and returns HEAD and the validated gitdir. */
export async function commitWorktree(
  request: CommitRequest,
): Promise<{ sha: string; gitDir: string }> {
  const gitDir = await assertLinkedWorktree(request.worktree);
  await request.afterValidate?.();
  const home = await mkdtemp(join(tmpdir(), "friday-git-home-"));
  try {
    const exec = async (args: string[], env: Record<string, string>, okCodes = [0]) => {
      const result = await execa(request.git, args, {
        cwd: request.worktree,
        env,
        extendEnv: false,
        reject: false,
      });
      if (!okCodes.includes(result.exitCode ?? -1)) {
        throw new Error(`Falha ao criar o commit: ${String(result.stderr ?? "")}`);
      }
      return result;
    };
    const first = await exec(GUARD_CONFIG_ARGS, stepEnv(request, gitDir, home, []), [0, 1]);
    const guards = guardsOf(String(first.stdout ?? ""));
    const env = stepEnv(request, gitDir, home, guards.drivers, guards.hooks);
    await exec(["add", "-A"], env);
    const diff = await exec(["diff-index", "--cached", "--quiet", "HEAD"], env, [0, 1]);
    if (diff.exitCode === 1) {
      const commit = [...identityArgs(), "commit", "--no-verify", "-m", request.message];
      await exec(commit, env);
    }
    const sha = String((await exec(["rev-parse", "HEAD"], env)).stdout ?? "").trim();
    if (!SHA_RE.test(sha))
      throw new Error("Falha ao criar o commit: o git devolveu um SHA inválido.");
    return { sha, gitDir };
  } finally {
    await rm(home, { recursive: true, force: true });
  }
}
