import { describe, expect, it, vi } from "vitest";
import { runDaemonCommand } from "../src/daemon.ts";
import { setup, validRoot } from "./daemon-helpers.ts";

async function start(over: { pending?: boolean } = {}) {
  const exit = vi.fn();
  const s = setup({ FRIDAY_HOME: validRoot() }, { exit });
  let resolveIdle: () => void = () => {};
  let rejectIdle: (e: Error) => void = () => {};
  if (over.pending ?? true) {
    s.idle.mockImplementation(
      () =>
        new Promise<void>((res, rej) => {
          resolveIdle = res;
          rejectIdle = rej;
        }),
    );
  }
  let result: { stdout: string; stderr: string; code: number } | undefined;
  const p = runDaemonCommand(["daemon"], s.deps).then((r) => {
    result = r;
    return r;
  });
  await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
  const flush = () => new Promise((r) => setTimeout(r, 0));
  return {
    s,
    exit,
    p,
    resolveIdle: () => resolveIdle(),
    rejectIdle: (e: Error) => rejectIdle(e),
    flush,
    result: () => result,
  };
}

describe("daemon signals", () => {
  it("exits 130 on the second signal while idle is pending", async () => {
    const t = await start();
    t.s.fire();
    t.s.fire();
    expect(await t.p).toEqual({ stdout: "", stderr: "", code: 130 });
  });

  it("never calls release after a forced exit", async () => {
    const t = await start();
    t.s.fire();
    t.s.fire();
    await t.p;
    t.resolveIdle();
    await t.flush();
    expect(t.s.release).not.toHaveBeenCalled();
    expect(t.exit).toHaveBeenCalledTimes(1);
  });

  it("ignores a late idle rejection after a forced exit", async () => {
    const t = await start();
    t.s.fire();
    t.s.fire();
    const out = await t.p;
    t.rejectIdle(new Error("tarde"));
    await t.flush();
    expect(t.s.release).not.toHaveBeenCalled();
    expect(out.code).toBe(130);
    expect(t.exit).toHaveBeenCalledTimes(1);
  });

  it("ignores signals after the second", async () => {
    const t = await start();
    t.s.fire();
    t.s.fire();
    t.s.fire();
    await t.p;
    expect(t.s.stop).toHaveBeenCalledTimes(1);
    expect(t.s.idle).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledTimes(1);
    expect(t.s.release).not.toHaveBeenCalled();
  });

  it("releases and returns the error when idle rejects on a single signal", async () => {
    const t = await start({ pending: false });
    t.s.idle.mockRejectedValue(new Error("falhou"));
    t.s.fire();
    expect(await t.p).toEqual({ stdout: "", stderr: "falhou\n", code: 1 });
    expect(t.s.release).toHaveBeenCalledTimes(1);
  });

  it("releases and returns the error when api.close rejects", async () => {
    const t = await start({ pending: false });
    t.s.apiClose.mockImplementation(async () => {
      t.s.order.push("api-close");
      throw new Error("fecha");
    });
    t.s.fire();
    expect(await t.p).toEqual({ stdout: "", stderr: "fecha\n", code: 1 });
    expect(t.s.order).toEqual(["stop", "api-close", "idle", "release"]);
    expect(t.s.release).toHaveBeenCalledTimes(1);
  });

  it("keeps waiting on a single signal while idle is pending", async () => {
    const t = await start();
    t.s.fire();
    await t.flush();
    expect(t.result()).toBeUndefined();
    expect(t.s.release).not.toHaveBeenCalled();
    expect(t.exit).not.toHaveBeenCalled();
  });

  it("calls exit(130) once on a forced exit", async () => {
    const t = await start();
    t.s.fire();
    expect(t.exit).not.toHaveBeenCalled();
    t.s.fire();
    await t.p;
    expect(t.exit).toHaveBeenCalledTimes(1);
    expect(t.exit).toHaveBeenCalledWith(130);
  });

  it("keeps the single-signal order and never exits", async () => {
    const t = await start({ pending: false });
    t.s.fire();
    expect(await t.p).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(t.s.order).toEqual(["stop", "api-close", "idle", "release"]);
    expect(t.exit).not.toHaveBeenCalled();
  });
});
