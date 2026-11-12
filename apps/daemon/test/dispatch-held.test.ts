import { describe, expect, it, vi } from "vitest";
import { classifyRisk, decideGates, type IssueRow } from "@friday/application";
import {
  createStateDispatcher,
  type DispatchConfig,
  type DispatchRole,
  type RunRequestBuilder,
  type StateDispatcherDeps,
} from "../src/index.ts";
import { FakeEvents, FakeGitHub, FakeIssueRepository, fakeRequest } from "./fakes.ts";

const CONFIG: DispatchConfig = {
  risk: {
    rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
    max_changed_lines: 400,
    max_changed_files: 20,
  },
  mergeMode: "manual",
  screenPaths: [],
};

const row = (issueId: number, state: string, heldReason: string | null = null): IssueRow => ({
  projectId: "p",
  issueId,
  state,
  heldReason,
  verifyRound: 0,
  qaRound: 0,
  reviewIter: 0,
});

function setup(options: {
  states: Record<number, string>;
  extraLabels?: Record<number, string[]>;
  roles: Partial<Record<DispatchRole, RunRequestBuilder>>;
}) {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, []);
  const github = new FakeGitHub([]);
  for (const [id, state] of Object.entries(options.states)) {
    issues.rows.set(Number(id), row(Number(id), state));
    github.issues.push({
      number: Number(id),
      title: `t${id}`,
      body: "",
      labels: options.extraLabels?.[Number(id)] ?? ["friday"],
    });
  }
  const log = vi.fn<(m: string) => void>();
  const deps: StateDispatcherDeps = {
    projectId: "p",
    github,
    issues,
    events,
    roles: options.roles,
    readConfig: () => CONFIG,
    prOf: () => 5,
    now: () => new Date("2026-11-05T03:00:00.000Z"),
    log,
    classifyRisk,
    decideGates,
  };
  return { dispatcher: createStateDispatcher(deps), issues, log };
}

describe("state dispatcher held issues", () => {
  it("listReady skips a Held issue with JudgeContextMissing without logging", async () => {
    const tb = vi.fn<RunRequestBuilder>((id) => fakeRequest(id));
    const t = setup({
      states: { 11: "InReview", 12: "Held" },
      extraLabels: { 12: ["friday"] },
      roles: { judge: tb },
    });
    t.issues.rows.set(12, row(12, "Held", "JudgeContextMissing"));
    await expect(t.dispatcher.listReady()).resolves.toEqual([11]);
    expect(t.log).not.toHaveBeenCalled();
  });
});
