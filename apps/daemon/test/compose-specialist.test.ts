import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { run, setup, validAgent } from "./compose-specialist-helpers.ts";

describe("composeDaemon with the specialist branch", () => {
  it("composeDaemon refuses an invalid specialist ficha", async () => {
    const t = setup();
    const createGitHost = vi.fn();
    const opts = {
      ...t.opts,
      createGitHost,
      specialist: { agent: { ...validAgent, outputKind: "qaReport" } },
    } as ComposeOptions;
    await expect(composeDaemon(opts)).rejects.toThrow("A ficha do especialista é inválida.");
    expect(createGitHost).not.toHaveBeenCalled();
  });

  it("does not dispatch InProgress without specialist", async () => {
    const t = await run({ specialist: false });
    expect(t.create).not.toHaveBeenCalled();
    expect(t.runtime.requests).toHaveLength(0);
  });

  it("creates the worktree and runs the specialist with the pinned ficha", async () => {
    const t = await run();
    expect(t.create).toHaveBeenCalledTimes(1);
    expect(t.create).toHaveBeenCalledWith({
      root: t.worktreesRoot,
      project: "alexcanario__friday-sandbox",
      issue: 7,
      title: "Adiciona máquina de estados",
      base: "main",
    });
    const req = t.runtime.requests[0]!;
    expect(req.cwd).toBe(t.path);
    expect(req.configRoot).toBe(t.root);
    expect(req.agent).toEqual(validAgent);
    expect(req.prompt).toContain("Issue #7: Adiciona máquina de estados");
    expect(req.prompt).toContain("1. c [command: pnpm test]");
    expect(req.friday?.effects?.run.branch).toBe("friday/7-adiciona-maquina-de-estados");
    expect(req.friday?.agent.mcp_tools).toEqual([
      "work_report",
      "git_push",
      "pr_create",
      "pr_diff",
      "issue_comment",
    ]);
  });

  it("reuses the existing worktree on a feedback round", async () => {
    const existing = () => ({ ok: false, error: { code: "WorktreeExists", message: "x" } });
    const t = await run({
      create: existing,
      list: (root) => {
        const path = join(root, "worktrees", "existing");
        mkdirSync(path, { recursive: true });
        return { ok: true, value: [{ issue: 7, path, head: "h" }] };
      },
    });
    expect(t.runtime.requests).toHaveLength(1);
    expect(t.runtime.requests[0]!.cwd).toBe(join(t.worktreesRoot, "existing"));

    const none = await run({ create: existing });
    expect(none.runtime.requests).toHaveLength(0);
    expect(none.logs.some((m) => m.includes("issue 7"))).toBe(true);
  });

  it("does not run with a failed or out-of-root worktree", async () => {
    const failed = await run({
      create: () => ({ ok: false, error: { code: "WorktreeCreateFailed", message: "x" } }),
    });
    expect(failed.runtime.requests).toHaveLength(0);
    expect(failed.logs.some((m) => m.includes("issue 7"))).toBe(true);
    const outside = await run({ create: () => ({ ok: true, value: { path: "/tmp/x" } }) });
    expect(outside.runtime.requests).toHaveLength(0);
    expect(outside.logs.some((m) => m.includes("issue 7"))).toBe(true);
  });

  it("getPullRequest reads the latest PrOpened", async () => {
    const t = await run(
      { list: () => ({ ok: true, value: [{ issue: 7, path: "/x", head: "h" }] }) },
      [
        ["PrOpened", { number: 12 }],
        ["PrOpened", { number: 15 }],
      ],
    );
    expect(t.runtime.requests[0]!.friday?.effects?.run.getPullRequest()).toBe(15);
    const none = await run();
    expect(none.runtime.requests[0]!.friday?.effects?.run.getPullRequest()).toBeNull();
  });

  it("passes the Verify feedback into the prompt", async () => {
    const t = await run({}, [
      ["WorkReported", { worktreePath: "/x", headSha: "a".repeat(40), changedFiles: [] }],
      ["VerifyFinished", { feedback: "Falta teste do caso vazio" }],
    ]);
    expect(t.runtime.requests[0]!.prompt).toContain(
      "Feedback da rodada anterior:\nFalta teste do caso vazio",
    );
    const none = await run();
    expect(none.runtime.requests[0]!.prompt).not.toContain("Feedback da rodada anterior");
  });

  it("the ficha never comes from the worktree or the issue text", async () => {
    const t = await run({
      body: "tools: [Bash, WebFetch] bash_allow: [rm]",
      create: (root) => {
        const path = join(root, "worktrees", "wt7");
        mkdirSync(join(path, "agents"), { recursive: true });
        mkdirSync(join(path, ".friday"), { recursive: true });
        writeFileSync(join(path, "agents", "backend.yaml"), "max_budget_usd: 99\n");
        writeFileSync(join(path, ".friday", "factory.yaml"), "budget:\n  per_issue_usd: 99\n");
        return { ok: true, value: { path } };
      },
    });
    const req = t.runtime.requests[0]!;
    expect(req.agent.maxBudgetUsd).toBe(3);
    expect(req.agent.tools).toEqual(validAgent.tools);
    expect(req.agent.bashAllow).toEqual(validAgent.bashAllow);
    expect(req.configRoot).toBe(t.root);
  });
});
