import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { toAgentRunOptions } from "@friday/application";
import { loadFactoryConfig } from "@friday/infrastructure";
import { runDaemonCommand } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

type Opts = {
  root: string;
  judge: {
    agents: Record<string, unknown>;
    input: (n: number) => { cwd: string; prompt: string; configRoot: string };
  };
};
const P = (n: number) =>
  `Review the pull request of issue #${n}. Read the diff with pr_diff and finish by calling review_verdict once.`;
const optsOf = (s: ReturnType<typeof setup>) => (s.compose.mock.calls[0] as unknown[])[0] as Opts;

describe("daemon judge input", () => {
  it("passes judge.input with the production values to compose", async () => {
    const root = validRoot();
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    expect(optsOf(s).judge.input(7)).toEqual({
      cwd: join(root, "worktrees", "alexcanario__friday-sandbox", "7"),
      prompt: P(7),
      configRoot: root,
    });
  });

  it("configRoot is the central root and never a worktree (com FRIDAY_HOME e com homeDir)", async () => {
    const homeDir = mkdtempSync(join(tmpdir(), "friday-home-"));
    const central = join(homeDir, ".friday");
    mkdirSync(central);
    cpSync(validRoot(), central, { recursive: true });
    const cases = [
      setup({ FRIDAY_HOME: validRoot() }),
      setup({}, {}, homeDir),
    ];
    for (const s of cases) {
      await runUntilSignal(s);
      const opts = optsOf(s);
      for (const n of [1, 7, 999]) {
        const { configRoot, cwd } = opts.judge.input(n);
        expect(configRoot).toBe(opts.root);
        const rel = relative(join(configRoot, "worktrees"), cwd);
        expect(rel).not.toBe("");
        expect(rel.startsWith("..")).toBe(false);
      }
    }
    expect(optsOf(cases[1]!).root).toBe(central);
  });

  it("passes the judge and judge-strong cards as run options", async () => {
    const root = validRoot();
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    const loaded = loadFactoryConfig(root);
    if (!loaded.ok) throw new Error("fixture inválido");
    const { agents } = optsOf(s).judge;
    expect(agents.judge).toEqual(toAgentRunOptions(loaded.agents["judge"]!));
    expect(agents["judge-strong"]).toEqual(toAgentRunOptions(loaded.agents["judge-strong"]!));
    expect(agents.judge).toMatchObject({ model: "sonnet", promptFile: "prompts/judge.md" });
    expect(agents["judge-strong"]).toMatchObject({ model: "opus", promptFile: "prompts/judge.md" });
  });

  it("fails closed without a judge card", async () => {
    for (const missing of ["judge-strong.yaml", "judge.yaml"]) {
      const root = validRoot();
      rmSync(join(root, "agents", missing));
      const s = setup({ FRIDAY_HOME: root });
      expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
        stdout: "",
        stderr: "A ficha judge ou judge-strong não está no registro central.\n",
        code: 1,
      });
      expect(s.compose).not.toHaveBeenCalled();
      expect(s.createWorktrees).not.toHaveBeenCalled();
    }
  });
});
