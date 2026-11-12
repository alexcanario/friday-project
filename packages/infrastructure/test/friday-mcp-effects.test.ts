import { FakeGitHost, FakeGitHubPort, type EffectsRun } from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { makeEffectHandler } from "../src/friday-mcp-effects.ts";

const SHA = "a".repeat(40);
const RUN: EffectsRun = {
  issue: 96,
  role: "specialist",
  branch: "friday/96-x",
  base: "develop",
  worktree: "/w",
  getPullRequest: () => 7,
};

function handlerOf(gitHost: FakeGitHost, run: EffectsRun) {
  return makeEffectHandler("git_push", {
    runId: "r1",
    agent: { states: ["InProgress"], mcp_tools: ["git_push"] },
    getIssueState: () => "InProgress",
    runs: { isActive: () => true },
    effects: { github: new FakeGitHubPort(), gitHost, run },
  });
}

const ARGS = { branch: RUN.branch, message: "m" };

describe("git_push onPushed hook", () => {
  it("git_push calls onPushed with the pushed sha", async () => {
    const onPushed = vi.fn<(sha: string) => void>();
    const handler = handlerOf(new FakeGitHost({ sha: SHA }), { ...RUN, onPushed });
    const reply = await handler(ARGS);
    expect(onPushed).toHaveBeenCalledTimes(1);
    expect(onPushed).toHaveBeenCalledWith(SHA);
    expect(reply).toEqual({ content: [{ type: "text", text: `200: push feito: ${SHA}.` }] });
  });

  it("git_push failure skips onPushed; a throwing onPushed keeps 200", async () => {
    const onPushed = vi.fn<(sha: string) => void>();
    const failing = handlerOf(new FakeGitHost({ fail: new Error("x") }), { ...RUN, onPushed });
    const failed = await failing(ARGS);
    expect(onPushed).not.toHaveBeenCalled();
    expect(failed).toEqual({
      content: [{ type: "text", text: "500: Falha ao executar git_push (effect_failed)." }],
      isError: true,
    });
    const throwing = vi.fn<(sha: string) => void>(() => {
      throw new Error("gancho");
    });
    const ok = await handlerOf(new FakeGitHost({ sha: SHA }), { ...RUN, onPushed: throwing })(ARGS);
    expect(throwing).toHaveBeenCalledTimes(1);
    expect(ok).toEqual({ content: [{ type: "text", text: `200: push feito: ${SHA}.` }] });
  });
});
