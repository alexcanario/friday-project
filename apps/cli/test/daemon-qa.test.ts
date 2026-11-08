import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toAgentRunOptions } from "@friday/application";
import { loadFactoryConfig } from "@friday/infrastructure";
import type { QaCompose } from "@friday/daemon";
import { qaComposeOf } from "../src/daemon-qa.ts";
import { runDaemonCommand } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

type QaOpts = {
  agent: { model: string; maxBudgetUsd: number; promptFile: string };
  context: (issueId: number, runId: string, read: ReadPort) => QaCtx | null;
};

type QaCtx = {
  issue: { number: number; title: string; body: string };
  base: string;
  screenPaths: string[];
  branch: string;
  getPullRequest: () => number | null;
  friday: { runId: string; agent: unknown; getIssueState: () => string | undefined };
};
type ReadPort = Parameters<QaCompose["context"]>[2];
type Ev = { type: string; seq: number; payload: unknown };

function readOf(events: Ev[], state: string | null = "QA"): ReadPort {
  return {
    projectId: "p",
    events: { list: () => events, append: () => events[0] },
    issues: { get: () => (state === null ? null : { state }) },
  } as unknown as ReadPort;
}
const ingested = (payload: unknown, seq = 1): Ev => ({ type: "IssueIngested", seq, payload });
const good = { number: 7, title: "Montar o contexto", body: "Corpo", labels: ["friday"] };

function qaOf(s: ReturnType<typeof setup>): QaOpts {
  const opts = (s.compose.mock.calls[0] as unknown[])[0] as { qa: QaOpts };
  return opts.qa;
}

function loadedOf(root: string) {
  const loaded = loadFactoryConfig(root);
  if (!loaded.ok) throw new Error("fixture inválido");
  return loaded;
}

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

describe("friday daemon qa card", () => {
  it("passes the qa card from the central registry to compose", async () => {
    const root = validRoot();
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    const qa = qaOf(s);
    expect(qa).toBeDefined();
    expect(qa.agent).toEqual(toAgentRunOptions(loadedOf(root).agents["qa"]!));
    expect(qa.agent.model).toBe("sonnet");
    expect(qa.agent.maxBudgetUsd).toBe(1.5);
    expect(qa.agent.promptFile).toBe("prompts/qa.md");
  });

  it("fails closed without a qa card", async () => {
    const root = validRoot();
    // Without agents/qa.yaml the roster check (state QA without agent) rejects the factory first;
    // the daemon still fails closed before compose. The null branch of qaComposeOf is covered by C5.
    rmSync(join(root, "agents", "qa.yaml"));
    const s = setup({ FRIDAY_HOME: root });
    expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
      stdout: "",
      stderr: "O factory.yaml está inválido ou ausente.\n",
      code: 1,
    });
    expect(s.compose).not.toHaveBeenCalled();
    expect(s.createWorktrees).not.toHaveBeenCalled();
  });

  it("reads the qa card from the central root, never from the cwd", async () => {
    const root = validRoot();
    const other = mkdtempSync(join(tmpdir(), "friday-cwd-"));
    mkdirSync(join(other, "agents"));
    const card = loadedOf(root).agents["qa"]!;
    expect(card.model).toBe("sonnet");
    writeFileSync(
      join(other, "agents", "qa.yaml"),
      "role: qa\nstates: [QA]\nmodel: opus\nmax_budget_usd: 1.5\nmax_turns: 20\ntimeout_s: 1800\ntools: [Read]\nprompt_file: prompts/qa.md\n",
    );
    process.chdir(other);
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    expect(qaOf(s).agent.model).toBe("sonnet");
  });

  async function contextOf(events: Ev[], state: string | null = "QA") {
    const s = setup({ FRIDAY_HOME: validRoot() });
    await runUntilSignal(s);
    return qaOf(s).context(7, "r1", readOf(events, state));
  }

  it("qa context builds title, body, branch, pull request and issue state from the read port", async () => {
    const c = await contextOf([
      ingested(good),
      { type: "PrOpened", seq: 2, payload: { number: 42 } },
    ]);
    expect(c).not.toBeNull();
    expect(c!.issue).toEqual({ number: 7, title: "Montar o contexto", body: "Corpo" });
    expect(c!.base).toBe("main");
    expect(c!.screenPaths).toEqual(["**/*.razor"]);
    expect(c!.branch).toBe("friday/7-montar-o-contexto");
    expect(c!.friday.runId).toBe("r1");
    expect(c!.friday.agent).toEqual({ states: ["QA"], mcp_tools: [] });
    expect(c!.getPullRequest()).toBe(42);
    expect(c!.friday.getIssueState()).toBe("QA");
  });

  it("qa context returns a null pull request before PrOpened", async () => {
    const c = await contextOf([ingested(good)]);
    expect(c).not.toBeNull();
    expect(c!.getPullRequest()).toBeNull();
  });

  it("qa context fails closed without ingested title or body, or without the issue row", async () => {
    expect(await contextOf([])).toBeNull();
    expect(await contextOf([ingested({ number: 7, title: "T", labels: ["friday"] })])).toBeNull();
    expect(await contextOf([ingested({ ...good, body: "" })])).toBeNull();
    expect(await contextOf([ingested({ ...good, title: "" })])).toBeNull();
    expect(await contextOf([ingested(good)], null)).toBeNull();
  });

  it("qaComposeOf returns null without the qa card", () => {
    const loaded = loadedOf(validRoot());
    const rest = Object.fromEntries(Object.entries(loaded.agents).filter(([k]) => k !== "qa"));
    expect(qaComposeOf({ ...loaded, agents: rest })).toBeNull();
    expect(qaComposeOf(loaded)?.agent.model).toBe("sonnet");
  });
});
