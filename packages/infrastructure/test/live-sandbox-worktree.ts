import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execa } from "execa";

export const SANDBOX = {
  owner: "alexcanario",
  repo: process.env.FRIDAY_GH_REPO ?? "friday-sandbox",
};
export const SANDBOX_URL = `https://github.com/${SANDBOX.owner}/${SANDBOX.repo}.git`;

export interface SandboxWorktree {
  repoDir: string;
  worktree: string;
  mirrorDir: string;
  dispose: () => void;
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((out, secret) => out.split(secret).join("***"), text);
}

async function git(args: string[], cwd: string | undefined, token: string): Promise<void> {
  const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
  const result = await execa("git", args, {
    cwd,
    reject: false,
    env: {
      GIT_TERMINAL_PROMPT: "0",
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: basic ${b64}`,
    },
  });
  if (result.exitCode === 0) return;
  const stderr = redact(String(result.stderr ?? ""), [token, b64]);
  throw new Error(`git ${args[0]} falhou: ${stderr}`);
}

/** Clones the sandbox into a temp dir and adds a worktree on a new branch cut from `develop`. */
export async function prepareSandboxWorktree(
  token: string,
  branch: string,
): Promise<SandboxWorktree> {
  const root = mkdtempSync(join(tmpdir(), "friday-live-sbx-"));
  const repoDir = join(root, "repo");
  const worktree = join(root, "wt");
  const mirrorDir = join(root, "mirror.git");
  const dispose = () => rmSync(root, { recursive: true, force: true, maxRetries: 3 });
  try {
    await git(["clone", "--quiet", "--branch", "develop", SANDBOX_URL, repoDir], undefined, token);
    await git(["worktree", "add", "--quiet", "-b", branch, worktree, "HEAD"], repoDir, token);
  } catch (error) {
    dispose();
    throw error;
  }
  return { repoDir, worktree, mirrorDir, dispose };
}
