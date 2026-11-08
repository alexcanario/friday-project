import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runDaemonCommand } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

const expected = { maxTurns: 10, timeoutMs: 600000, promptFile: "prompts/triage.md" };
const failure = {
  stdout: "",
  stderr: "A ficha triage não está no registro central.\n",
  code: 1,
};

function composeOpts(s: ReturnType<typeof setup>): Record<string, unknown> {
  return (s.compose.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
}

describe("friday daemon triage card", () => {
  it("passes the triage card as compose option (FRIDAY_HOME and homeDir)", async () => {
    const home = validRoot();
    const a = setup({ FRIDAY_HOME: home });
    await runUntilSignal(a);
    expect(composeOpts(a).triage).toEqual(expected);
    expect(composeOpts(a).root).toBe(home);

    const homeDir = mkdtempSync(join(tmpdir(), "friday-home-"));
    const central = validRoot();
    const target = join(homeDir, ".friday");
    cpSync(central, target, { recursive: true });
    const b = setup({}, {}, homeDir);
    await runUntilSignal(b);
    expect(composeOpts(b).triage).toEqual(expected);
    expect(composeOpts(b).root).toBe(target);
  });

  it("fails closed without a valid triage card", async () => {
    const missing = validRoot();
    rmSync(join(missing, "agents", "triage.yaml"));
    const invalid = validRoot();
    const path = join(invalid, "agents", "triage.yaml");
    writeFileSync(path, readFileSync(path, "utf8").replace("role: triage", "role: backend"));
    for (const home of [missing, invalid]) {
      const s = setup({ FRIDAY_HOME: home });
      expect(await runDaemonCommand(["daemon"], s.deps)).toEqual(failure);
      expect(s.compose).not.toHaveBeenCalled();
      expect(s.createWorktrees).not.toHaveBeenCalled();
    }
  });
});
