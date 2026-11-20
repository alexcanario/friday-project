import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { Daemon } from "@friday/daemon";
import { openDatabase } from "@friday/infrastructure";
import { apiDepsOf, startPanel, type StartApi } from "../src/daemon-panel.ts";
import { startDaemon } from "../src/daemon.ts";
import { setup, validRoot } from "./daemon-helpers.ts";

const dbOf = () =>
  openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-log-")), "friday.db"));

describe("panel log", () => {
  it("hands the log to the api deps", async () => {
    const db = dbOf();
    try {
      const daemon = { db, github: {}, release: vi.fn() } as unknown as Daemon;
      const log = vi.fn();
      expect(apiDepsOf(daemon, {}, log).log).toBe(log);
      expect(apiDepsOf(daemon, {}).log).toBeUndefined();

      const start = vi.fn(async () => ({
        address: "127.0.0.1",
        port: 7777,
        close: async () => {},
      }));
      const sink = vi.fn();
      await startPanel(daemon, start as unknown as StartApi, 7777, sink, {});
      const options = (start.mock.calls[0] as unknown as [{ deps: { log?: unknown } }])[0];
      expect(typeof options.deps.log).toBe("function");
      (options.deps.log as (m: string) => void)("abc");
      expect(sink).toHaveBeenCalledWith("abc");
    } finally {
      db.close();
    }
  });

  it("redacts the panel token and github token shapes in the api log", async () => {
    const db = dbOf();
    try {
      const run = async (token: string | undefined, message: string): Promise<string[]> => {
        const lines: string[] = [];
        const s = setup(
          { FRIDAY_HOME: validRoot(), FRIDAY_PANEL_TOKEN: token },
          { log: (m: string) => void lines.push(m) },
        );
        s.compose.mockResolvedValue({ ...s.daemon, db } as never);
        const p = startDaemon(s.deps);
        await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
        const given = (
          s.startApi.mock.calls[0] as unknown as [{ deps: { log: (m: string) => void } }]
        )[0];
        given.deps.log(message);
        s.fire();
        await p;
        return lines;
      };
      const masked = await run("tok-secret-123", "erro tok-secret-123 ghp_abc123DEF fim");
      expect(masked).toContain("erro *** *** fim");
      expect(masked.join("\n")).not.toContain("tok-secret-123");
      expect(masked).toContain("Painel em http://127.0.0.1:7777");
      for (const token of [undefined, ""]) {
        expect(await run(token, "erro sem segredo")).toContain("erro sem segredo");
      }
    } finally {
      db.close();
    }
  });
});
