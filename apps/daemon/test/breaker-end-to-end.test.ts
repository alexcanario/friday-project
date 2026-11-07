import { describe, expect, it } from "vitest";
import { MIN, setup } from "./breaker-dispatch-helpers.ts";

describe("breaker end to end", () => {
  async function runOne(t: ReturnType<typeof setup>, id: number) {
    t.source.ready = [id];
    await t.ticker.tick();
    await t.ticker.idle();
  }

  it("opens after three runtime failures and closes after 30 minutes", async () => {
    const t = setup({ steps: ["failed", "timeout", new Error("boom")] });
    for (const id of [7, 8, 9]) await runOne(t, id);
    expect(t.real.isOpen()).toBe(true);
    const row = t.db.sqlite.prepare("SELECT opened_at FROM breaker_state").get() as {
      opened_at: string | null;
    };
    expect(row.opened_at).not.toBeNull();
    await runOne(t, 10);
    expect(t.runtime.requests).toHaveLength(3);
    expect(t.issues.get("p", 10)).toMatchObject({ state: "Held", heldReason: "BreakerOpen" });
    t.clock.advance(30 * MIN);
    await runOne(t, 11);
    expect(t.runtime.requests).toHaveLength(4);
  });

  it("other statuses do not open the breaker", async () => {
    const t = setup({ steps: ["failed", "timeout", "succeeded", "budget_exceeded"] });
    for (const id of [7, 8, 9, 10]) await runOne(t, id);
    expect(t.real.isOpen()).toBe(false);
    await runOne(t, 11);
    expect(t.runtime.requests).toHaveLength(5);
  });
});
