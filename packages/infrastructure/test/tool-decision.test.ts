import { describe, expect, it } from "vitest";
import { buildToolPolicy, decideToolCall } from "../src/index.ts";
import type { AgentRunOptions } from "@friday/application";
import { judge, qa, specialist } from "./policy-helpers.ts";

const fakeRealpath = (p: string): string => {
  if (p === "/work/wt/17/link") return "/outside";
  if (p === "/work/wt/17" || p === "/work" || p === "/") return p;
  throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
};
const identity = (p: string): string => p;

function decide(
  agent: AgentRunOptions,
  worktree: string,
  toolName: string,
  toolInput: unknown,
  realpath: (p: string) => string = fakeRealpath,
): boolean {
  const r = buildToolPolicy(agent, worktree, { realpath });
  if (!r.ok) throw new Error("policy");
  return decideToolCall(r.policy, { toolName, toolInput }).allow;
}

describe("decideToolCall", () => {
  const W = "/work/wt/17";
  it("specialist: allows and denies on posix", () => {
    const s = (n: string, i: unknown) => decide(specialist(), W, n, i);
    expect(s("Read", { file_path: "/work/wt/17/src/a.ts" })).toBe(true);
    expect(s("Write", { file_path: "src/b.ts" })).toBe(true);
    expect(s("Edit", { file_path: "src/../src/c.ts" })).toBe(true);
    expect(s("Glob", { pattern: "src/**/*.ts" })).toBe(true);
    expect(s("Grep", { pattern: "x" })).toBe(true);
    expect(s("Read", { file_path: ".claude/settings.json" })).toBe(true);
    expect(s("Write", { file_path: "../x.ts" })).toBe(false);
    expect(s("Read", { file_path: "/etc/passwd" })).toBe(false);
    expect(s("Read", { file_path: "src/../../etc/passwd" })).toBe(false);
    expect(s("Read", { file_path: "/work/wt/170/a.ts" })).toBe(false);
    expect(s("Write", { file_path: ".claude/settings.json" })).toBe(false);
    expect(s("Edit", { file_path: ".friday/agents/qa.yaml" })).toBe(false);
    expect(s("Write", { file_path: "/work/wt/17/.claude/x" })).toBe(false);
    expect(s("Glob", { pattern: "/etc/*" })).toBe(false);
    expect(s("Glob", { pattern: "../*" })).toBe(false);
    expect(s("WebFetch", { url: "https://x" })).toBe(false);
    expect(s("mcp__other__run", {})).toBe(false);
    expect(s("Read", {})).toBe(false);
    expect(s("Read", null)).toBe(false);
    expect(s("Grep", { pattern: "x", path: "~/.claude" })).toBe(false);
    expect(s("Glob", { path: " /etc", pattern: "*" })).toBe(false);
    expect(s("Glob", { pattern: "{../..,src}/*" })).toBe(false);
    expect(s("Read", { file_path: "link/x" })).toBe(false);
  });

  it("qa and judge: allows and denies by role", () => {
    const q = (n: string, i: unknown) => decide(qa(), W, n, i);
    expect(q("Read", { file_path: "src/a.ts" })).toBe(true);
    expect(q("Bash", { command: "pnpm test" })).toBe(true);
    expect(q("mcp__friday__qa_report", {})).toBe(true);
    expect(q("Write", { file_path: "a.ts" })).toBe(false);
    expect(q("Edit", { file_path: "a.ts" })).toBe(false);
    expect(q("Bash", { command: "ls" })).toBe(false);
    expect(q("mcp__friday__git_push", {})).toBe(false);
    const j = (n: string, i: unknown) => decide(judge(), W, n, i);
    expect(j("Read", { file_path: "src/a.ts" })).toBe(true);
    expect(j("Grep", { pattern: "x" })).toBe(true);
    expect(j("Bash", { command: "pnpm test" })).toBe(false);
    expect(j("Write", { file_path: "a.ts" })).toBe(false);
    expect(j("mcp__friday__qa_report", {})).toBe(false);
    expect(decide(qa({ bashAllow: [] }), W, "Bash", { command: "pnpm test" })).toBe(false);
  });

  it("win32 worktree: normalizes paths and denies outside", () => {
    const w = (n: string, i: unknown) => decide(specialist(), "C:\\work\\wt\\17", n, i, identity);
    expect(w("Read", { file_path: "C:\\work\\wt\\17\\src\\a.ts" })).toBe(true);
    expect(w("Read", { file_path: "c:/work/wt/17/src/a.ts" })).toBe(true);
    expect(w("Read", { file_path: "src\\a.ts" })).toBe(true);
    expect(w("Read", { file_path: "C:\\Users\\alex\\.env" })).toBe(false);
    expect(w("Read", { file_path: "C:\\work\\wt\\17\\..\\..\\x" })).toBe(false);
    expect(w("Read", { file_path: "C:\\work\\wt\\170\\a.ts" })).toBe(false);
    expect(w("Read", { file_path: "D:\\work\\wt\\17\\a.ts" })).toBe(false);
    expect(w("Write", { file_path: "C:\\work\\wt\\17\\.claude\\x" })).toBe(false);
    expect(w("Write", { file_path: "C:\\WORK\\WT\\17\\.CLAUDE\\x" })).toBe(false);
  });
});
