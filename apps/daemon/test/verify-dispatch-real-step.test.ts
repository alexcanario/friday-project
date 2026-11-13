import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runVerifyForIssue, runVerifyStep } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const SHA = "a".repeat(40);
const FIXTURE = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

function registry(command: string): string {
  const root = mkdtempSync(join(tmpdir(), "verify-dispatch-reg-"));
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
    `verify:\n  command: ${JSON.stringify(command)}\n  timeout_s: 60\n`,
  );
  writeFileSync(file, yaml);
  return root;
}

async function run(command: string) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  issues.rows.set(7, {
    projectId: "p",
    issueId: 7,
    state: "Verify",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  });
  const worktreePath = mkdtempSync(join(tmpdir(), "verify-dispatch-"));
  events.append({
    projectId: "p",
    issueId: 7,
    runId: "r0",
    type: "WorkReported",
    payload: { worktreePath, headSha: SHA, changedFiles: ["src/A.cs"] },
    actor: "daemon",
    at: "2026-11-05T03:00:00.000Z",
  });
  const registryRoot = registry(command);
  const result = await runVerifyForIssue(
    {
      projectId: "p",
      recorder: { projectId: "p", events, issues, now: () => new Date("2026-11-05T03:00:00.000Z") },
      step: (input) =>
        runVerifyStep(
          { registryRoot, repoDir: registryRoot, env: ENV, readHead: async () => SHA },
          input,
        ),
    },
    7,
  );
  return { result, events: events.list("p", 7) };
}

describe("verify dispatch with the real step", () => {
  it("runs the real verify step on a fixture registry and applies pass and fail", async () => {
    const pass = await run(`node -e "process.exit(0)"`);
    expect(pass.result.applied).toBe(true);
    expect(pass.events.at(-1)?.payload).toMatchObject({ to: "QA", trigger: "VerifyPassed" });

    const fail = await run(`node -e "console.log('marker-out'); process.exit(1)"`);
    expect(fail.result.feedback).toContain("marker-out");
    const types = fail.events.map((e) => e.type);
    expect(types).toEqual(["WorkReported", "StateChanged", "VerifyFinished"]);
    expect(fail.events[1]!.payload).toMatchObject({ to: "InProgress" });
    expect(fail.events[2]!.payload).toMatchObject({ outcome: "verify_failed" });
    expect((fail.events[2]!.payload as { feedback: string }).feedback).toContain("marker-out");
  });
});
