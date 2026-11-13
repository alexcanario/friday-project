import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { boot, run, setup, type Over } from "./compose-specialist-helpers.ts";

const createFailed = () => ({
  ok: false,
  error: { code: "WorktreeCreateFailed", message: "Não foi possível criar a worktree: boom" },
});
const exists = () => ({ ok: false, error: { code: "WorktreeExists", message: "x" } });

type Ran = Awaited<ReturnType<typeof run>>;

const stateOf = (t: Ran) => createIssueRepository(t.daemon.db).get("p", 7);
const heldEvents = (t: Ran) =>
  createEventStore(t.daemon.db)
    .list("p", 7)
    .filter(
      (e) => e.type === "StateChanged" && (e.payload as { trigger?: string }).trigger === "RunHeld",
    );

function expectHeldRuntimeFailed(t: Ran): void {
  expect(stateOf(t)).toMatchObject({ state: "Held", heldReason: "RuntimeFailed" });
  const held = heldEvents(t);
  expect(held).toHaveLength(1);
  expect(held[0]).toMatchObject({
    runId: null,
    payload: { to: "Held", trigger: "RunHeld", heldReason: "RuntimeFailed" },
  });
  expect(t.runtime.requests).toHaveLength(0);
}

describe("composeDaemon holds the issue when the worktree is unusable", () => {
  it("holds the issue with RuntimeFailed when create fails", async () => {
    const t = await run({ create: createFailed });
    expectHeldRuntimeFailed(t);
    expect(t.logs.some((m) => m.includes("issue 7") && m.includes("boom"))).toBe(true);
  });

  it("does not call create again on the next tick after the hold", async () => {
    const t = setup({ create: createFailed });
    const daemon = await boot(t);
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.create).toHaveBeenCalledTimes(1);
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.create).toHaveBeenCalledTimes(1);
  });

  it("still reuses the worktree on WorktreeExists and does not hold", async () => {
    const t = await run({
      create: exists,
      list: (root) => {
        const path = join(root, "worktrees", "existing");
        mkdirSync(path, { recursive: true });
        return { ok: true, value: [{ issue: 7, path, head: "h" }] };
      },
    });
    expect(t.runtime.requests).toHaveLength(1);
    expect(stateOf(t)?.heldReason).not.toBe("RuntimeFailed");
    expect(
      heldEvents(t).filter(
        (e) => (e.payload as { heldReason?: string }).heldReason === "RuntimeFailed",
      ),
    ).toHaveLength(0);
  });

  it("holds the issue when the existing worktree is not listed or is outside the root", async () => {
    const cases: Over[] = [
      { create: exists },
      { create: () => ({ ok: true, value: { path: "/tmp/x" } }) },
    ];
    for (const over of cases) expectHeldRuntimeFailed(await run(over));
  });
});
