import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runVerifyForIssue, runVerifyStep } from "../src/index.ts";
import { FakeEvents, FakeIssueRepository } from "./fakes.ts";

const SHA = "a".repeat(40);
const FIXTURE = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");

function registry(): string {
  const root = mkdtempSync(join(tmpdir(), "verify-held-reg-"));
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
    `verify:\n  command: ${JSON.stringify(`node -e "process.exit(0)"`)}\n  timeout_s: 60\n`,
  );
  writeFileSync(file, yaml);
  return root;
}

describe("verify dispatch when the head cannot be read", () => {
  it("a readHead failure holds the issue and does not retry", async () => {
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
    events.append({
      projectId: "p",
      issueId: 7,
      runId: "r0",
      type: "WorkReported",
      payload: {
        worktreePath: mkdtempSync(join(tmpdir(), "verify-held-")),
        headSha: SHA,
        changedFiles: ["a.ts"],
      },
      actor: "daemon",
      at: "2026-11-05T03:00:00.000Z",
    });
    const registryRoot = registry();
    const logs: string[] = [];
    let calls = 0;
    const deps = {
      projectId: "p",
      recorder: { projectId: "p", events, issues, now: () => new Date("2026-11-05T03:00:00.000Z") },
      log: (m: string) => logs.push(m),
      step: (input: Parameters<typeof runVerifyStep>[1]) => {
        calls++;
        return runVerifyStep(
          {
            registryRoot,
            repoDir: registryRoot,
            env: { PATH: process.env.PATH },
            readHead: async () => {
              throw new Error("gitdir de outro repositório");
            },
          },
          input,
        );
      },
    };
    expect((await runVerifyForIssue(deps, 7)).applied).toBe(true);
    const row = issues.get("p", 7)!;
    expect(row.state).toBe("Held");
    expect(row.heldReason).toBe("RuntimeFailed");
    expect(logs).toContain("A issue 7 foi retida em Verify: gitdir de outro repositório");
    expect((await runVerifyForIssue(deps, 7)).applied).toBe(false);
    expect(calls).toBe(1);
  });
});
