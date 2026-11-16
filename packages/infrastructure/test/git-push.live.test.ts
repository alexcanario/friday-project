// Run (PowerShell): $env:FRIDAY_LIVE='1'; $env:FRIDAY_AUTHOR_TOKEN='<token do friday-author>'; $env:npm_config_manage_package_manager_versions='false'; npx -y pnpm@12.16.1 --filter @friday/infrastructure exec vitest run test/git-push.live.test.ts
// Prova real do GitCliHost.push (#152, D66, D86) contra o friday-sandbox. O token só vem do ambiente (D42, D89).
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createGitHubClient, GitCliHost } from "../src/index.ts";
import {
  prepareSandboxWorktree,
  SANDBOX,
  SANDBOX_URL,
  type SandboxWorktree,
} from "./live-sandbox-worktree.ts";

const LIVE = process.env.FRIDAY_LIVE === "1";
const TOKEN_ENV = "FRIDAY_AUTHOR_TOKEN";
const stamp = `${Date.now()}`;
const branch = `friday/${stamp}-smoke`;
const FAKE_TOKEN = `ghp_fake_${stamp}_not_a_real_token`;

describe.skipIf(!LIVE)("GitCliHost.push (live, #152)", () => {
  let box: SandboxWorktree;
  let pushed = false;
  const octokit = () => createGitHubClient(process.env[TOKEN_ENV] ?? "");
  const host = (over: { token?: () => Promise<string>; gitBinary?: string } = {}) =>
    new GitCliHost({
      ...(over.token === undefined ? { tokenEnv: TOKEN_ENV } : { token: over.token }),
      repoDir: box.repoDir,
      mirrorDir: box.mirrorDir,
      targetUrl: SANDBOX_URL,
      ...(over.gitBinary === undefined ? {} : { gitBinary: over.gitBinary }),
    });

  beforeAll(async () => {
    const token = process.env[TOKEN_ENV];
    if (token === undefined || token.trim() === "") throw new Error(`Defina ${TOKEN_ENV}.`);
    box = await prepareSandboxWorktree(token, branch);
  }, 120_000);

  afterEach(() => vi.restoreAllMocks());

  afterAll(async () => {
    if (pushed) {
      await octokit()
        .request("DELETE /repos/{owner}/{repo}/git/refs/{ref}", {
          ...SANDBOX,
          ref: `heads/${branch}`,
        })
        .catch(() => undefined);
    }
    box?.dispose();
  });

  it("refuses develop and main before any git process starts", async () => {
    // A binary that does not exist: if `push` reached git, the error would be ENOENT, not the validation.
    const guarded = host({ gitBinary: "friday-no-such-git" });
    for (const target of ["develop", "main"]) {
      await expect(
        guarded.push({ worktree: box.worktree, branch: target, message: "m" }),
      ).rejects.toThrow(/Nome de branch inválido/);
    }
  });

  it("never prints the token, even when the remote rejects it", async () => {
    const seen: string[] = [];
    const capture = (chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    writeFileSync(join(box.worktree, "denied.txt"), "x\n");
    const b64 = Buffer.from(`x-access-token:${FAKE_TOKEN}`).toString("base64");
    let message = "";
    try {
      await host({ token: async () => FAKE_TOKEN }).push({
        worktree: box.worktree,
        branch,
        message: `test: token inválido (${stamp})`,
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/Falha no git push/);
    for (const text of [message, seen.join("")]) {
      expect(text).not.toContain(FAKE_TOKEN);
      expect(text).not.toContain(b64);
    }
  }, 120_000);

  it("pushes friday/<n>-smoke with the real token and the ref reaches GitHub", async () => {
    const token = process.env[TOKEN_ENV] ?? "";
    mkdirSync(join(box.worktree, "live"), { recursive: true });
    writeFileSync(join(box.worktree, "live", `${stamp}.txt`), "push vivo da #152\n");
    const seen: string[] = [];
    const capture = (chunk: unknown) => {
      seen.push(String(chunk));
      return true;
    };
    vi.spyOn(process.stdout, "write").mockImplementation(capture);
    vi.spyOn(process.stderr, "write").mockImplementation(capture);
    const out = await host().push({
      worktree: box.worktree,
      branch,
      message: `test: push vivo da #152 (${stamp})`,
    });
    pushed = true;
    vi.restoreAllMocks();
    expect(out.sha).toMatch(/^[0-9a-f]{40}$/);

    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    for (const text of [JSON.stringify(out), seen.join("")]) {
      expect(text).not.toContain(token);
      expect(text).not.toContain(b64);
    }
    const ref = await octokit().request("GET /repos/{owner}/{repo}/git/ref/{ref}", {
      ...SANDBOX,
      ref: `heads/${branch}`,
    });
    expect(ref.data.object.sha).toBe(out.sha);
  }, 120_000);
});
