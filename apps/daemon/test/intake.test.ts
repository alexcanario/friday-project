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
      {
        ...common,
        type: "IssueIngested",
        payload: { number: 7, title: "T", body: "B", labels: ["friday"] },
      },
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
    expect(issues.rebuilds).toEqual([{ projectId: "p", appendedCount: 2 }]);
    expect(issues.get("p", 7)?.state).toBe("Todo");
  });

  it("records the issue body in IssueIngested", async () => {
    const { events, github, intake } = setup();
    github.issues.push(issue(7));
    await intake.ingest();
    expect(events.appended[0]?.payload).toEqual({
      number: 7,
      title: "T",
      body: "B",
      labels: ["friday"],
    });
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

  it("does not repeat IssueIngested when the StateChanged append failed", async () => {
    const { events, github, logs, intake } = setup();
    github.issues.push(issue(7));
    let fail = true;
    events.failWhen = (e) => (fail && e.type === "StateChanged" ? new Error("boom") : null);
    expect(await intake.ingest()).toEqual([]);
    expect(logs).toContain("Failed to ingest issue 7: boom");
    fail = false;
    expect(await intake.ingest()).toEqual([7]);
    expect(events.appended.map((e) => e.type)).toEqual(["IssueIngested", "StateChanged"]);
  });

  it("only rebuilds when both events exist and rebuild failed before", async () => {
    const { events, issues, github, intake } = setup();
    github.issues.push(issue(7));
    const realRebuild = issues.rebuild.bind(issues);
    let fail = true;
    issues.rebuild = (projectId: string) => {
      if (fail) throw new Error("rebuild boom");
      realRebuild(projectId);
    };
    expect(await intake.ingest()).toEqual([]);
    expect(events.appended).toHaveLength(2);
    fail = false;
    expect(await intake.ingest()).toEqual([7]);
    expect(events.appended.map((e) => e.type)).toEqual(["IssueIngested", "StateChanged"]);
    expect(issues.rebuilds).toHaveLength(1);
    expect(issues.get("p", 7)?.state).toBe("Todo");
  });

  it("records both events after the first append failed", async () => {
    const { events, github, intake } = setup();
    github.issues.push(issue(7));
    let fail = true;
    events.failWhen = (e) => (fail && e.type === "IssueIngested" ? new Error("boom") : null);
    expect(await intake.ingest()).toEqual([]);
    expect(events.appended).toEqual([]);
    fail = false;
    expect(await intake.ingest()).toEqual([7]);
    expect(events.appended.map((e) => e.type)).toEqual(["IssueIngested", "StateChanged"]);
  });

  it("resumes a partial issue and ingests a new one in the same call", async () => {
    const { events, github, intake } = setup();
    github.issues.push(issue(7), issue(8));
    let fail = true;
    events.failWhen = (e) =>
      fail && e.type === "StateChanged" && e.issueId === 7 ? new Error("boom") : null;
    expect(await intake.ingest()).toEqual([8]);
    fail = false;
    events.appended.length = 0;
    events.appended.push({
      type: "IssueIngested",
      projectId: "p",
      issueId: 7,
      runId: null,
      actor: "daemon",
      at: NOW,
      payload: { number: 7, title: "T", body: "B", labels: ["friday"] },
    });
    expect(await intake.ingest()).toEqual([7, 8]);
    expect(events.appended.filter((e) => e.issueId === 7).map((e) => e.type)).toEqual([
      "IssueIngested",
      "StateChanged",
    ]);
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
