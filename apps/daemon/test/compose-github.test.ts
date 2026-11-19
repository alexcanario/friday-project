import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { setup } from "./compose-helpers.ts";

describe("composeDaemon github", () => {
  it("exposes the github port on the daemon and keeps compose.ts within 300 lines", async () => {
    const t = setup();
    (t.github as unknown as { getPrMergeState: (pr: number) => Promise<unknown> }).getPrMergeState =
      async (pr) => ({ merged: false, headSha: `h${pr}` });
    const daemon = await composeDaemon(t.opts);
    expect(await daemon.github.getPrMergeState(7)).toEqual({ merged: false, headSha: "h7" });
    daemon.release();
    const src = readFileSync(join(import.meta.dirname, "../src/compose.ts"), "utf8");
    expect(src.split("\n").length).toBeLessThanOrEqual(301);
  });
});
