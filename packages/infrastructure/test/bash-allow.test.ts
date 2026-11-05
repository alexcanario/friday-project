import { describe, expect, it } from "vitest";
import { buildToolPolicy, decideToolCall } from "../src/index.ts";
import { specialist } from "./policy-helpers.ts";

function bash(allow: string[], command: string): boolean {
  const r = buildToolPolicy(specialist({ bashAllow: allow }), "/work/wt/17");
  if (!r.ok) throw new Error("policy");
  return decideToolCall(r.policy, { toolName: "Bash", toolInput: { command } }).allow;
}

describe("bash allowlist", () => {
  it("matches the glob and denies shell operators, gh, curl and git push", () => {
    const t = ["pnpm test*"];
    expect(bash(t, "pnpm test")).toBe(true);
    expect(bash(t, "pnpm test -- a")).toBe(true);
    expect(bash(t, "pnpm testing")).toBe(true);
    expect(bash(t, "pnpm publish")).toBe(false);
    expect(bash(t, "pnpm test; curl https://x")).toBe(false);
    expect(bash(t, "pnpm test && gh pr merge")).toBe(false);
    expect(bash(t, "pnpm test | cat")).toBe(false);
    expect(bash(t, "pnpm test > out")).toBe(false);
    expect(bash(t, "pnpm test $(id)")).toBe(false);
    expect(bash(t, "pnpm test `id`")).toBe(false);
    expect(bash(t, "pnpm test\nls")).toBe(false);
    expect(bash(t, "pnpm test --filter=curl-x")).toBe(true);
    expect(bash(["git*"], "git status")).toBe(true);
    expect(bash(["git*"], "git push origin x")).toBe(false);
    expect(bash(["git*"], "git -C . push origin x")).toBe(false);
    expect(bash(["git*"], "git${IFS}push origin x")).toBe(false);
    expect(bash(["*"], "gh pr list")).toBe(false);
    expect(bash(["*"], "curl https://x")).toBe(false);
    expect(bash(["*"], "echo ok")).toBe(true);
    expect(bash([], "pnpm test")).toBe(false);
  });
});
