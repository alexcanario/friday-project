import { describe, expect, it } from "vitest";
import type { AgentRunRequest } from "@friday/application";
import { runJudgeForIssue } from "../src/judge-dispatch.ts";
import { judgeFridayOf } from "../src/judge-request.ts";
import { FakeIssueRepository, FakeEvents } from "./fakes.ts";
import { TOKEN, finished, logged, noTokenLeak, setup, verdict } from "./judge-dispatch-helpers.ts";

function hookingRuntime(t: ReturnType<typeof setup>, error: unknown, calls: { n: number }) {
  t.deps.step.runtime = {
    run: (r: AgentRunRequest) => {
      const run = r.friday!.effects!.run;
      run.onEffectError!("pr_diff", error);
      calls.n += 1;
      return Promise.resolve(finished(verdict()));
    },
  };
}

const linesWith = (t: ReturnType<typeof setup>, text: string) =>
  t.log.mock.calls.map((c) => c[0]).filter((m) => m.includes(text));

describe("judge effect error hook", () => {
  it("judgeFridayOf sets onEffectError on the run only when given", () => {
    const issues = new FakeIssueRepository(new FakeEvents());
    const input = {
      projectId: "p",
      issueId: 7,
      runId: "r1",
      pr: 30,
      base: "main",
      cwd: "/tmp/wt",
      issues,
    };
    const hook = () => undefined;
    const withHook = judgeFridayOf({ ...input, onEffectError: hook }).effects!.run;
    const without = judgeFridayOf(input).effects!.run;
    expect(withHook.onEffectError).toBe(hook);
    expect(without.onEffectError).toBeUndefined();
    for (const run of [withHook, without]) {
      expect(run.issue).toBe(7);
      expect(run.role).toBe("judge");
      expect(run.branch).toBe("friday/7");
      expect(run.base).toBe("main");
    }
  });

  it("logs the failed tool and issue through log", async () => {
    const t = setup();
    const calls = { n: 0 };
    hookingRuntime(t, new Error("falha"), calls);
    await runJudgeForIssue(t.deps, 7);
    expect(calls.n).toBe(1);
    const lines = linesWith(t, "Falha na ferramenta");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("pr_diff");
    expect(lines[0]).toContain("issue 7");
    expect(lines[0]).toContain("falha");
    const quiet = setup();
    await runJudgeForIssue(quiet.deps, 7);
    expect(linesWith(quiet, "Falha na ferramenta")).toHaveLength(0);
  });

  it("masks the review token in the effect error log", async () => {
    const t = setup();
    hookingRuntime(t, new Error(`falha ${TOKEN}`), { n: 0 });
    await runJudgeForIssue(t.deps, 7);
    const lines = linesWith(t, "Falha na ferramenta");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("***");
    noTokenLeak(t);
    expect(logged(t)).not.toContain(TOKEN);
  });

  it("does not throw without log and keeps the verdict", async () => {
    const t = setup();
    t.deps.log = undefined;
    const calls = { n: 0 };
    hookingRuntime(t, new Error("falha"), calls);
    const result = await runJudgeForIssue(t.deps, 7);
    expect(calls.n).toBe(1);
    expect(result.applied).toBe(true);
    expect(t.types()).toContain("ReviewApproved");
  });
});
