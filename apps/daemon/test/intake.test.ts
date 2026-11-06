import type { IssueRow } from "@friday/application";
import { describe, expect, it } from "vitest";
import { createIntake } from "../src/index.ts";
import { FakeEvents, FakeGitHub, FakeIssueRepository } from "./fakes.ts";

const NOW = "2026-11-05T03:00:00.000Z";

function issue(number: number) {
  return { number, title: "T", body: "B", labels: ["friday"] };
}

function row(issueId: number): IssueRow {
  return {
    projectId: "p",
    issueId,
    state: "InProgress",
    heldReason: null,
    verifyRound: 0,
    qaRound: 0,
    reviewIter: 0,
  };
}

function setup() {
  const events = new FakeEvents();
  const issues = new FakeIssueRepository(events, undefined, { projectFromEvents: true });
  const github = new FakeGitHub();
  const logs: string[] = [];
  const intake = createIntake({
    projectId: "p",
    github,
    issues,
    events,
    now: () => new Date(NOW),
    log: (m) => logs.push(m),
  });
  return { events, issues, github, logs, intake };
}

describe("createIntake", () => {
  it("ingests an issue with no row and records IssueIngested then StateChanged", async () => {
    const { events, issues, github, intake } = setup();
    github.issues.push(issue(7));
    expect(await intake.ingest()).toEqual([7]);
    expect(github.listCalls).toEqual(["friday"]);
    const common = { projectId: "p", issueId: 7, actor: "daemon", runId: null, at: NOW };
    expect(events.appended).toEqual([
      { ...common, type: "IssueIngested", payload: { number: 7, title: "T", labels: ["friday"] } },
      {
        ...common,
        type: "StateChanged",
        payload: {
          type: "StateChanged",
          issueId: "7",
          from: "Backlog",
          to: "Todo",
          trigger: "Admitted",
          heldReason: null,
          verifyRound: 0,
          qaRound: 0,
          reviewIter: 0,
        },
      },
    ]);
    expect(events.appended[0]?.payload).not.toHaveProperty("body");
    expect(issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 2 }]);
    expect(issues.get("p", 7)?.state).toBe("Todo");
  });

  it("ignores an issue that already has a row and records no event", async () => {
    const { events, issues, github, intake } = setup();
    github.issues.push(issue(7));
    issues.rows.set(7, row(7));
    expect(await intake.ingest()).toEqual([]);
    expect(events.appended).toEqual([]);
    expect(issues.rebuilds).toHaveLength(0);
  });

  it("does not ingest the same issue twice", async () => {
    const { events, github, intake } = setup();
    github.issues.push(issue(7));
    expect(await intake.ingest()).toEqual([7]);
    expect(await intake.ingest()).toEqual([]);
    expect(events.appended.map((e) => e.type)).toEqual(["IssueIngested", "StateChanged"]);
  });

  it("ingests only the issues without a row, in GitHub order", async () => {
    const { events, issues, github, intake } = setup();
    github.issues.push(issue(9), issue(7), issue(8));
    issues.rows.set(8, row(8));
    expect(await intake.ingest()).toEqual([9, 7]);
    expect(events.appended.map((e) => [e.type, e.issueId])).toEqual([
      ["IssueIngested", 9],
      ["StateChanged", 9],
      ["IssueIngested", 7],
      ["StateChanged", 7],
    ]);
  });

  it("logs and continues when one issue or the listing fails", async () => {
    const { events, github, logs, intake } = setup();
    github.issues.push(issue(9), issue(7));
    events.failWhen = (e) =>
      e.type === "IssueIngested" && e.issueId === 9 ? new Error("boom") : null;
    expect(await intake.ingest()).toEqual([7]);
    expect(logs).toContain("Failed to ingest issue 9: boom");
    expect(events.appended.some((e) => e.issueId === 9)).toBe(false);

    github.listIssuesByLabel = () => Promise.reject(new Error("boom"));
    expect(await intake.ingest()).toEqual([]);
    expect(logs).toContain("Failed to list issues: boom");
  });

  it("default FakeIssueRepository rebuild leaves rows untouched", () => {
    const events = new FakeEvents();
    const issues = new FakeIssueRepository(events);
    events.append({
      type: "StateChanged",
      projectId: "p",
      issueId: 7,
      runId: null,
      actor: "x",
      at: NOW,
      payload: { to: "Todo" },
    });
    issues.rebuild("p");
    expect(issues.rows.size).toBe(0);
  });
});
