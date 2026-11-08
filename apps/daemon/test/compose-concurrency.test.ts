import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { assertSingleConcurrentRun, composeDaemon, readGuardedTickConfig } from "../src/index.ts";
import { setup } from "./compose-helpers.ts";

const withLimit = (n: number) => (y: string) =>
  y.replace("limits:\n", `limits:\n  max_concurrent_runs: ${n}\n`);
const startMessage = (n: number) =>
  `limits.max_concurrent_runs = ${n} não é aceito: a conferência de teto ainda não reserva as runs ativas; use 1 ou omita a opção (D72).`;
const tickMessage = (n: number) =>
  `limits.max_concurrent_runs = ${n} não é aceito: nenhuma run será despachada neste tick; use 1 ou omita a opção (D74).`;

describe("concurrent run guard", () => {
  it("rejects max_concurrent_runs 2 with the pt-BR message", async () => {
    const t = setup(withLimit(2));
    await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(startMessage(2)));
  });

  it("rejects max_concurrent_runs 3 with the value in the message", async () => {
    const t = setup(withLimit(3));
    await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(startMessage(3)));
  });

  it("leaves no lock, no database and no GitHub client after the refusal", async () => {
    const t = setup(withLimit(2));
    await expect(composeDaemon(t.opts)).rejects.toThrow();
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(join(t.root, ".friday", "daemon.lock"))).toBe(false);
    expect(t.createGitHub).not.toHaveBeenCalled();
  });

  it("accepts max_concurrent_runs 1 and the omitted option", async () => {
    for (const t of [setup(withLimit(1)), setup()]) {
      const daemon = await composeDaemon(t.opts);
      expect(() => daemon.release()).not.toThrow();
    }
  });

  it("assertSingleConcurrentRun throws above 1 and passes at 1, omitted or missing file", () => {
    expect(() => assertSingleConcurrentRun(setup(withLimit(2)).root)).toThrow(
      new Error(startMessage(2)),
    );
    expect(() => assertSingleConcurrentRun(setup(withLimit(1)).root)).not.toThrow();
    expect(() => assertSingleConcurrentRun(setup().root)).not.toThrow();
    const missing = setup().root;
    rmSync(join(missing, "factory.yaml"));
    expect(() => assertSingleConcurrentRun(missing)).not.toThrow();
  });

  it("readGuardedTickConfig returns null and logs above 1", () => {
    const log = vi.fn();
    expect(readGuardedTickConfig(setup(withLimit(2)).root, log)).toBeNull();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(tickMessage(2));
  });

  it("readGuardedTickConfig passes 1, omitted and invalid files through silently", () => {
    const log = vi.fn();
    const expected = { enabled: true, maxConcurrentRuns: 1, perIssueUsd: 5, perDayUsd: 10 };
    expect(readGuardedTickConfig(setup(withLimit(1)).root, log)).toEqual(expected);
    expect(readGuardedTickConfig(setup().root, log)).toEqual(expected);
    const invalid = setup((y) => y.replace("enabled: true", 'enabled: "sim"'));
    expect(readGuardedTickConfig(invalid.root, log)).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });

  it("ticker logs when max_concurrent_runs rises above 1 after startup", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    const file = join(t.root, "factory.yaml");
    const original = readFileSync(file, "utf8");
    const count = () => t.logs.filter((m) => m === tickMessage(2)).length;
    writeFileSync(file, withLimit(2)(original));
    await daemon.ticker.tick();
    expect(count()).toBe(1);
    writeFileSync(file, withLimit(1)(original));
    await daemon.ticker.tick();
    expect(count()).toBe(1);
    daemon.release();
  });
});
