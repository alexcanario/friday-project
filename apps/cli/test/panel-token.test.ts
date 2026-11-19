import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { StartApi } from "../src/daemon-panel.ts";
import { buildApp } from "@friday/api";
import type { Daemon } from "@friday/daemon";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiDepsOf, startPanel } from "../src/daemon-panel.ts";

let db: FridayDatabase;
afterEach(() => db.close());

function open() {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-token-")), "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1')").run();
  const getPrMergeState = vi.fn<(pr: number) => Promise<{ merged: boolean; headSha: string }>>(
    async () => ({
      merged: false,
      headSha: "h7",
    }),
  );
  const squashMerge = vi.fn(async () => ({ merged: true as const, sha: "s" }));
  const github = { getPrMergeState, squashMerge } as unknown as Daemon["github"];
  return { github, getPrMergeState };
}

describe("panel token wiring", () => {
  it("wires the panel token from the environment and fails closed without it", async () => {
    const { github, getPrMergeState } = open();
    const deps = apiDepsOf({ db, github }, { FRIDAY_PANEL_TOKEN: "tok" });
    expect(deps.panelToken).toBe("tok");
    expect(await deps.readPrHead(7)).toBe("h7");
    expect(getPrMergeState).toHaveBeenCalledWith(7);
    expect(Object.keys(deps.github)).toEqual(["squashMerge"]);
    expect(deps.projects.list()).toEqual(["p1"]);

    for (const [env, expected] of [
      [{}, undefined],
      [{ FRIDAY_PANEL_TOKEN: "" }, ""],
    ] as const) {
      const closed = apiDepsOf({ db, github }, env);
      expect(closed.panelToken).toBe(expected);
      const app = await buildApp(closed);
      const deny = await app.inject({ method: "POST", url: "/approvals/x/deny" });
      expect(deny.statusCode).toBe(401);
      const read = await app.inject({ method: "GET", url: "/approvals?project=p1" });
      expect(read.statusCode).toBe(200);
      await app.close();
    }

    const start = vi.fn(async () => ({ address: "127.0.0.1", port: 7777, close: async () => {} }));
    const logs: string[] = [];
    const daemon = { db, github, release: () => {} } as unknown as Daemon;
    await startPanel(daemon, start as unknown as StartApi, 7777, (m) => logs.push(m), {
      FRIDAY_PANEL_TOKEN: "tok",
    });
    const call = start.mock.calls[0] as unknown as [{ deps: { panelToken: string } }];
    expect(call[0].deps.panelToken).toBe("tok");
    expect(logs.some((m) => m.includes("tok"))).toBe(false);
  });
});
