import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { toAgentRunOptions } from "@friday/application";
import { loadFactoryConfig } from "@friday/infrastructure";
import { qaComposeOf } from "../src/daemon-qa.ts";
import { runDaemonCommand } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

type QaOpts = {
  agent: { model: string; maxBudgetUsd: number; promptFile: string };
  context: (
    issueId: number,
    runId: string,
  ) => {
    issue: { number: number; title: string; body: string };
    base: string;
    screenPaths: string[];
  } | null;
};

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
    rmSync(join(root, "agents", "qa.yaml"));
    const s = setup({ FRIDAY_HOME: root });
    expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
      stdout: "",
      stderr: "A ficha qa não está no registro central.\n",
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

  it("qa context never returns empty issue data", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    await runUntilSignal(s);
    const c = qaOf(s).context(7, "r1");
    expect(
      c === null ||
        (c.issue.number === 7 &&
          c.base === "main" &&
          c.screenPaths.join() === "**/*.razor" &&
          c.issue.title !== "" &&
          c.issue.body !== ""),
    ).toBe(true);
  });

  it("qaComposeOf returns null without the qa card", () => {
    const loaded = loadedOf(validRoot());
    const { qa: _qa, ...rest } = loaded.agents;
    expect(qaComposeOf({ ...loaded, agents: rest })).toBeNull();
    expect(qaComposeOf(loaded)?.agent.model).toBe("sonnet");
  });
});
