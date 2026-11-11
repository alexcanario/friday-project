import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort } from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { createJudgeBranch } from "../src/judge-wiring.ts";
import { createRunRecorder } from "../src/run-recorder.ts";
import { fixture } from "./compose-helpers.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, slackBudget } from "./fakes.ts";
import { agents } from "./judge-dispatch-helpers.ts";
import { CountingPendingRuntime, FakeCiGitHub } from "./judge-fakes.ts";

describe("createJudgeBranch", () => {
  it("returns not applied when the issue is not listed", async () => {
    const root = mkdtempSync(join(tmpdir(), "friday-jw-"));
    cpSync(fixture, root, { recursive: true });
    const now = () => new Date("2026-11-05T03:00:00.000Z");
    const events = new FakeEvents();
    const recorder = { projectId: "p", events, issues: new FakeIssueRepository(events), now };
    const runtime = new CountingPendingRuntime();
    const log = vi.fn<(m: string) => void>();
    const github = new FakeCiGitHub();
    const { budget } = slackBudget(recorder);
    const branch = createJudgeBranch({
      projectId: "p",
      root,
      github: github as unknown as GitHubPort,
      reviewerFor: () => ({ postReview: () => Promise.resolve({ id: 1 }) }),
      compose: {
        agents: agents(),
        input: () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" }),
      },
      env: { FRIDAY_REVIEW_TOKEN: "jud9e" },
      runtime,
      prOf: () => 30,
      recorder,
      recording: { runs: new FakeRunRepository(), recorder: createRunRecorder(recorder) },
      budget,
      now,
      log,
    });
    await expect(branch(7)).resolves.toEqual({ applied: false, feedback: null });
    expect(runtime.calls).toBe(0);
    expect(log.mock.calls.map((c) => c[0]).join("\n")).toContain("Falha no Judge da issue 7:");
  });
});
