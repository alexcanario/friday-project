import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AlreadyRunningError } from "@friday/daemon";
import { runDaemonCommand, startDaemon } from "../src/daemon.ts";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

const cwd = process.cwd();
afterEach(() => process.chdir(cwd));

describe("friday daemon", () => {
  it("rejects extra arguments with the usage and runs compose without them", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    const usage = { stdout: "", stderr: "Uso: friday daemon\n", code: 2 };
    expect(await runDaemonCommand(["daemon", "extra"], s.deps)).toEqual(usage);
    expect(await runDaemonCommand(["daemon", "--x"], s.deps)).toEqual(usage);
    expect(s.compose).not.toHaveBeenCalled();
    await runUntilSignal(s);
    expect(s.compose).toHaveBeenCalledTimes(1);
  });

  it("uses the central root and refuses a relative or padded FRIDAY_HOME", async () => {
    const home = validRoot();
    const other = validRoot();
    writeFileSync(join(other, "factory.yaml"), "enabled: 'sim'\n");
    process.chdir(other);
    const s = setup({ FRIDAY_HOME: home });
    await runUntilSignal(s);
    const opts = (s.compose.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
    expect(opts.root).toBe(home);
    expect(opts.dbPath).toBe(join(home, "friday.db"));
    for (const bad of ["relativo", " /abs "]) {
      const b = setup({ FRIDAY_HOME: bad });
      const out = await runDaemonCommand(["daemon"], b.deps);
      expect(out).toEqual({
        stdout: "",
        stderr: "A variável FRIDAY_HOME deve ser um caminho absoluto.\n",
        code: 1,
      });
      expect(b.compose).not.toHaveBeenCalled();
    }
  });

  it("fails closed on a missing or invalid factory.yaml", async () => {
    const missing = mkdtempSync(join(tmpdir(), "friday-daemon-"));
    const invalid = validRoot();
    writeFileSync(join(invalid, "factory.yaml"), 'enabled: "sim"\n');
    for (const root of [missing, invalid]) {
      const s = setup({ FRIDAY_HOME: root });
      expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
        stdout: "",
        stderr: "O factory.yaml está inválido ou ausente.\n",
        code: 1,
      });
      expect(s.compose).not.toHaveBeenCalled();
      expect(s.createWorktrees).not.toHaveBeenCalled();
    }
  });

  it("passes projectId, env, homeDir, clock and worktrees to compose", async () => {
    const root = validRoot();
    const env = { FRIDAY_HOME: root };
    const s = setup(env);
    await runUntilSignal(s);
    expect(s.compose).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "alexcanario/friday-sandbox",
        env,
        homeDir: "/h",
        clock: s.clock,
        worktrees: s.worktrees,
      }),
    );
    expect((s.compose.mock.calls[0] as unknown[])[0]).toHaveProperty("env", env);
    expect(s.createWorktrees).toHaveBeenCalledTimes(1);
    expect(s.createWorktrees).toHaveBeenCalledWith(
      expect.objectContaining({ repoDir: join(root, "repos", "alexcanario__friday-sandbox") }),
    );
  });

  it("passes no prOf and the unwired runtime to compose", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    await runUntilSignal(s);
    const opts = (s.compose.mock.calls[0] as unknown[])[0] as {
      runtime: { run: (r: unknown) => Promise<unknown> };
    };
    expect("prOf" in opts).toBe(false);
    await expect(opts.runtime.run({})).rejects.toThrow("O runtime do ticker não está ligado.");
  });

  it("stops the ticker and releases once on a signal", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    let settled = false;
    const p = startDaemon(s.deps).then((r) => {
      settled = true;
      return r;
    });
    await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
    await Promise.resolve();
    expect(settled).toBe(false);
    s.fire();
    s.fire();
    const out = await p;
    expect(out.code).toBe(0);
    expect(s.start).toHaveBeenCalledTimes(1);
    expect(s.order).toEqual(["stop", "idle", "release"]);
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it("reports AlreadyRunning in pt-BR without starting", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    s.compose.mockRejectedValue(new AlreadyRunningError(101));
    expect(await startDaemon(s.deps)).toEqual({
      stdout: "",
      stderr: "Já existe um daemon em execução (PID 101).\n",
      code: 1,
    });
    expect(s.start).not.toHaveBeenCalled();
  });

  it("releases the daemon when ticker.start throws", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    s.start.mockImplementation(() => {
      throw new Error("falhou");
    });
    expect(await startDaemon(s.deps)).toEqual({ stdout: "", stderr: "falhou\n", code: 1 });
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.idle).not.toHaveBeenCalled();
  });

  it("returns the error when release also throws after start fails", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    s.start.mockImplementation(() => {
      throw new Error("falhou");
    });
    s.release.mockImplementation(() => {
      throw new Error("trava");
    });
    await expect(startDaemon(s.deps)).resolves.toEqual({
      stdout: "",
      stderr: "trava\n",
      code: 1,
    });
  });

  it("passes worktreesRoot under FRIDAY_HOME to compose", async () => {
    const root = validRoot();
    const s = setup({ FRIDAY_HOME: root });
    await runUntilSignal(s);
    expect(s.compose).toHaveBeenCalledWith(
      expect.objectContaining({ worktreesRoot: join(root, "worktrees") }),
    );
  });
});
