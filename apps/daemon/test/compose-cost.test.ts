import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, AgentRuntime, WorktreeManager } from "@friday/application";
import type { RunFinished } from "@friday/contracts";
import { createLedgerRepository } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, fakeRequest } from "./fakes.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const NOW = new Date("2026-11-05T03:00:00.000Z");
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

function finished(costUsd: number | null): RunFinished {
  return {
    status: "succeeded",
    subtype: null,
    model: null,
    costUsd,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  };
}

type Options = { ceiling?: number; cost?: number; throws?: boolean; yaml?: (y: string) => string };

function setup(o: Options = {}) {
  const root = mkdtempSync(join(tmpdir(), "friday-cost-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8");
  writeFileSync(file, (o.yaml ?? ((y) => y))(yaml));
  const github = new FakeGitHub();
  github.issues.push({ number: 7, title: "Issue", labels: ["friday"] } as never);
  const run = vi.fn<(r: AgentRunRequest) => Promise<RunFinished>>(() =>
    o.throws ? Promise.reject(new Error("boom")) : Promise.resolve(finished(o.cost ?? 0.5)),
  );
  const worktrees = {
    create: vi.fn(),
    remove: vi.fn(() => ok(undefined)),
    list: vi.fn(() => ok([])),
    listOrphans: vi.fn(() => ok([])),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
  const base = fakeRequest(7);
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    worktrees,
    runtime: { run } as unknown as AgentRuntime,
    createRuntime: () => ({ run }) as unknown as AgentRuntime,
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    createGitHub: (() => github) as unknown as ComposeOptions["createGitHub"],
    roles: {
      triage: (id) => ({
        ...fakeRequest(id),
        agent: { ...base.agent, maxBudgetUsd: o.ceiling ?? 1 },
      }),
    },
  };
  return { opts, run };
}

async function dispatch(o: Options) {
  const t = setup(o);
  const daemon = await composeDaemon(t.opts);
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  const sum = createLedgerRepository(daemon.db).sumByIssue("p", 7);
  daemon.release();
  return { ...t, sum };
}

describe("composeDaemon cost wiring", () => {
  it("records the run cost in the ledger", async () => {
    const t = await dispatch({});
    expect(t.run).toHaveBeenCalledTimes(1);
    expect(t.sum).toEqual({ costUsd: 0.5, anyCostUnknown: false });
  });

  it("records the ceiling as unknown cost when the runtime throws", async () => {
    const t = await dispatch({ throws: true });
    expect(t.sum).toEqual({ costUsd: 1, anyCostUnknown: true });
  });

  it("holds the run above the issue cap and runs it below", async () => {
    const over = await dispatch({ ceiling: 3 });
    expect(over.run).not.toHaveBeenCalled();
    expect(over.sum).toEqual({ costUsd: 0, anyCostUnknown: false });
    const under = await dispatch({ ceiling: 1 });
    expect(under.run).toHaveBeenCalledTimes(1);
  });

  it("holds the run above the day cap and runs it below", async () => {
    const edit = (y: string) => y.replace("per_day_usd: 10", "per_day_usd: 1.5");
    const over = await dispatch({ yaml: edit });
    expect(over.run).not.toHaveBeenCalled();
    const under = await dispatch({});
    expect(under.run).toHaveBeenCalledTimes(1);
  });
});
