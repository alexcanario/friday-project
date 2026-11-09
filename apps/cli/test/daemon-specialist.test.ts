import { rmSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { toAgentRunOptions } from "@friday/application";
import { loadFactoryConfig } from "@friday/infrastructure";
import { runDaemonCommand, specialistComposeOf } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

function loadedOf(root: string) {
  const loaded = loadFactoryConfig(root);
  if (!loaded.ok) throw new Error("fixture inválido");
  return loaded;
}

type ComposeOpts = {
  specialist: { agent: { states: string[]; maxBudgetUsd: number; promptFile: string } };
  log: (message: string) => void;
};
const optsOf = (s: ReturnType<typeof setup>) =>
  (s.compose.mock.calls[0] as unknown[])[0] as ComposeOpts;

describe("friday daemon specialist wiring", () => {
  it("passes the backend card as specialist compose option", async () => {
    const root = validRoot();
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    expect(s.compose).toHaveBeenCalledTimes(1);
    const { specialist } = optsOf(s);
    expect(specialist).toEqual({ agent: toAgentRunOptions(loadedOf(root).agents["backend"]!) });
    expect(specialist.agent.states).toEqual(["InProgress"]);
    expect(specialist.agent.maxBudgetUsd).toBe(1.5);
    expect(specialist.agent.promptFile).toBe("prompts/backend.md");
  });

  it("specialistComposeOf returns null without the backend card and the roster check stops the daemon", async () => {
    const loaded = loadedOf(validRoot());
    expect(specialistComposeOf({ ...loaded, agents: {} })).toBeNull();
    expect(specialistComposeOf(loaded)?.agent.states).toEqual(["InProgress"]);

    const root = validRoot();
    rmSync(join(root, "agents", "backend.yaml"));
    const s = setup({ FRIDAY_HOME: root });
    expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
      stdout: "",
      stderr: "O factory.yaml está inválido ou ausente.\n",
      code: 1,
    });
    expect(s.compose).not.toHaveBeenCalled();
    expect(s.createWorktrees).not.toHaveBeenCalled();
  });

  it("wires log to the injected writer and to stderr by default", async () => {
    const log = vi.fn();
    const injected = setup({ FRIDAY_HOME: validRoot() }, { log });
    await runUntilSignal(injected);
    expect(typeof optsOf(injected).log).toBe("function");
    optsOf(injected).log("Falha X");
    expect(log).toHaveBeenCalledWith("Falha X");

    const spy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const s = setup({ FRIDAY_HOME: validRoot() });
      await runUntilSignal(s);
      optsOf(s).log("Falha X");
      expect(spy).toHaveBeenCalledWith("Falha X\n");
    } finally {
      spy.mockRestore();
    }
  });
});
