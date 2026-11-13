import { mkdir, realpath, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { execa } from "execa";
import type { Result } from "@friday/domain";
import type {
  CreateWorktreeRequest,
  WorktreeError,
  WorktreeErrorCode,
  WorktreeInfo,
  WorktreeManager,
  WorktreeProject,
} from "@friday/application";

const RETRIABLE = new Set(["EBUSY", "EPERM", "ENOTEMPTY"]);
const ATTEMPTS = 3;
const RETRY_DELAY_MS = 200;
const SLUG_MAX = 40;

export interface GitWorktreeManagerDeps {
  repoDir: string;
  removeDir?: (path: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
}

export function branchName(issue: number, title: string): string {
  const slug = title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, SLUG_MAX)
    .replace(/^-+|-+$/g, "");
  return slug === "" ? `friday/${issue}` : `friday/${issue}-${slug}`;
}

const fail = (code: WorktreeErrorCode, message: string): Result<never, WorktreeError> => ({
  ok: false,
  error: { code, message },
});

const FULL_SHA = /^[0-9a-f]{40}$/;
const SAFE_REF = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;

/** Conservative subset of `git check-ref-format`: never empty, never starts with `-`. */
export function isSafeBase(base: string): boolean {
  return (
    SAFE_REF.test(base) &&
    !base.includes("..") &&
    !base.includes("//") &&
    !base.endsWith("/") &&
    !base.endsWith(".") &&
    !base.split("/").some((part) => part.startsWith(".") || part.endsWith(".lock"))
  );
}

const defaultRemoveDir = (path: string) => rm(path, { recursive: true, force: true });
const defaultSleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const errorCode = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

async function realpathOrNull(path: string): Promise<string | null> {
  try {
    return await realpath(path);
  } catch (e) {
    if (errorCode(e) === "ENOENT") return null;
    throw e;
  }
}

/** True when a link under `root` leads elsewhere: the physical path differs from the textual one. */
async function leavesRoot(root: string, target: string): Promise<boolean> {
  const physicalRoot = await realpathOrNull(root);
  if (physicalRoot === null) return false;
  for (let current = target; current !== root; current = dirname(current)) {
    const physical = await realpathOrNull(current);
    if (physical !== null) return physical !== join(physicalRoot, relative(root, current));
  }
  return false;
}

export class GitWorktreeManager implements WorktreeManager {
  private readonly repoDir: string;
  private readonly removeDir: (path: string) => Promise<void>;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(deps: GitWorktreeManagerDeps) {
    this.repoDir = deps.repoDir;
    this.removeDir = deps.removeDir ?? defaultRemoveDir;
    this.sleep = deps.sleep ?? defaultSleep;
  }

  async create(req: CreateWorktreeRequest): Promise<Result<{ path: string }, WorktreeError>> {
    const path = this.pathFor(req.root, req.project, req.issue);
    if (path === undefined) return fail("InvalidPath", "Caminho de worktree inválido.");
    if (!isSafeBase(req.base))
      return fail("WorktreeCreateFailed", `Branch base inválida: ${JSON.stringify(req.base)}.`);
    if (existsSync(path))
      return fail("WorktreeExists", `A worktree da issue ${req.issue} já existe.`);
    try {
      if (await leavesRoot(resolve(req.root), path))
        return fail("InvalidPath", "Caminho de worktree inválido.");
      await mkdir(dirname(path), { recursive: true });
      await this.git("fetch", "origin", req.base);
      await this.git(
        "-c",
        "core.autocrlf=false",
        "-c",
        "core.safecrlf=false",
        "-c",
        "core.eol=lf",
        "worktree",
        "add",
        "-b",
        branchName(req.issue, req.title),
        path,
        `origin/${req.base}`,
      );
      return { ok: true, value: { path } };
    } catch (e) {
      return fail("WorktreeCreateFailed", `Não foi possível criar a worktree: ${describe(e)}`);
    }
  }

  async remove(req: WorktreeProject & { issue: number }): Promise<Result<void, WorktreeError>> {
    const path = this.pathFor(req.root, req.project, req.issue);
    if (path === undefined) return fail("InvalidPath", "Caminho de worktree inválido.");
    try {
      if (await leavesRoot(resolve(req.root), path))
        return fail("InvalidPath", "Caminho de worktree inválido.");
      await this.removeWithRetry(path);
      await this.git("worktree", "prune");
      return { ok: true, value: undefined };
    } catch (e) {
      return fail("WorktreeRemoveFailed", `Não foi possível remover a worktree: ${describe(e)}`);
    }
  }

  async list(req: WorktreeProject): Promise<Result<WorktreeInfo[], WorktreeError>> {
    if (this.projectDir(req.root, req.project) === undefined)
      return fail("InvalidPath", "Caminho de worktree inválido.");
    try {
      // Physical root: git reports real paths, so a link or 8.3 root must be resolved first.
      const root = (await realpathOrNull(resolve(req.root))) ?? req.root;
      const dir = this.projectDir(root, req.project)!;
      const { stdout } = await this.git("worktree", "list", "--porcelain", "-z");
      return { ok: true, value: parseWorktrees(stdout, dir) };
    } catch (e) {
      return fail("WorktreeCreateFailed", `Não foi possível listar as worktrees: ${describe(e)}`);
    }
  }

  async listOrphans(
    req: WorktreeProject & { activeIssues: number[] },
  ): Promise<Result<WorktreeInfo[], WorktreeError>> {
    const all = await this.list(req);
    if (!all.ok) return all;
    const active = new Set(req.activeIssues);
    return { ok: true, value: all.value.filter((w) => !active.has(w.issue)) };
  }

  async isClean(path: string, head: string): Promise<boolean> {
    if (!/^[0-9a-f]{7,64}$/i.test(head)) return false;
    try {
      const status = await execa("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: path,
      });
      if (status.stdout.trim() !== "") return false;
      const current = await execa("git", ["rev-parse", "HEAD"], { cwd: path });
      const expected = await execa("git", ["rev-parse", "--verify", `${head}^{commit}`], {
        cwd: path,
      });
      return current.stdout.trim() === expected.stdout.trim();
    } catch {
      return false;
    }
  }

  async alignTo(path: string, sha: string): Promise<Result<void, WorktreeError>> {
    if (!FULL_SHA.test(sha))
      return fail("WorktreeCreateFailed", `O sha ${JSON.stringify(sha)} é inválido.`);
    try {
      const status = await execa("git", ["status", "--porcelain", "--untracked-files=all"], {
        cwd: path,
      });
      if (status.stdout.trim() !== "")
        return fail("WorktreeCreateFailed", "A worktree tem alterações e não foi alinhada.");
      await execa("git", ["fetch", "origin", sha], { cwd: path });
      await execa("git", ["checkout", "--detach", sha], { cwd: path });
      const head = await execa("git", ["rev-parse", "HEAD"], { cwd: path });
      if (head.stdout.trim() !== sha)
        return fail("WorktreeCreateFailed", "O HEAD da worktree não ficou no sha pedido.");
      return { ok: true, value: undefined };
    } catch (e) {
      return fail("WorktreeCreateFailed", `Não foi possível alinhar a worktree: ${describe(e)}`);
    }
  }

  private async removeWithRetry(path: string): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      try {
        await this.removeDir(path);
        return;
      } catch (e) {
        const code = errorCode(e);
        if (code === "ENOENT") return;
        if (code === undefined || !RETRIABLE.has(code) || attempt >= ATTEMPTS) throw e;
        await this.sleep(RETRY_DELAY_MS);
      }
    }
  }

  private git(...args: string[]) {
    return execa("git", args, { cwd: this.repoDir });
  }

  private projectDir(root: string, project: string): string | undefined {
    if (project === "" || /[\\/]/.test(project) || project === "." || project === "..") {
      return undefined;
    }
    return join(resolve(root), project);
  }

  private pathFor(root: string, project: string, issue: number): string | undefined {
    const dir = this.projectDir(root, project);
    if (dir === undefined || !Number.isInteger(issue) || issue <= 0) return undefined;
    return join(dir, String(issue));
  }
}

function parseWorktrees(porcelain: string, projectDir: string): WorktreeInfo[] {
  const found: WorktreeInfo[] = [];
  // With -z, fields end in NUL and records in a second NUL; paths come unquoted.
  for (const record of porcelain.split("\0\0")) {
    const fields = record.split("\0");
    const path = fields.find((f) => f.startsWith("worktree "))?.slice("worktree ".length);
    const head = fields.find((f) => f.startsWith("HEAD "))?.slice("HEAD ".length);
    if (path === undefined || head === undefined) continue;
    const rel = relative(projectDir, resolve(path));
    if (rel === "" || rel.startsWith("..") || rel.includes(sep) || !/^[1-9]\d*$/.test(rel))
      continue;
    found.push({ issue: Number(rel), path: resolve(path), head });
  }
  return found;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message.split("\n")[0]! : String(e);
}
