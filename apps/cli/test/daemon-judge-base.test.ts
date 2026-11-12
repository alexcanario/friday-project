import { describe, expect, it } from "vitest";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

describe("daemon judge base", () => {
  it("startDaemon passes repository.base to the judge compose", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    await runUntilSignal(s);
    const opts = (s.compose.mock.calls[0] as unknown[])[0] as { judge: { base: string } };
    expect(opts.judge.base).toBe("main");
  });
});
