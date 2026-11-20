import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Daemon } from "@friday/daemon";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MISSING_TOKEN_REFUSAL, startPanel, type StartApi } from "../src/daemon-panel.ts";
import { INSECURE_ORIGIN_REFUSAL } from "../src/panel-checks.ts";

let db: FridayDatabase | undefined;
afterEach(() => db?.close());

const TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const TEXT =
  "Painel não iniciado: FRIDAY_PANEL_ORIGINS tem uma origem sem HTTPS fora do loopback. Use https:// em toda origem que não seja 127.0.0.1, localhost ou [::1], e reinicie o daemon; o daemon continua rodando sem o painel.";

async function run(env: Record<string, string | undefined>) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-https-")), "friday.db"));
  const github = {} as Daemon["github"];
  const returned = { address: "127.0.0.1", port: 7777, close: async () => {} };
  const start = vi.fn(async () => returned);
  const release = vi.fn();
  const logs: string[] = [];
  const daemon = { db, github, release } as unknown as Daemon;
  const api = await startPanel(
    daemon,
    start as unknown as StartApi,
    7777,
    (m) => logs.push(m),
    env,
  );
  return { api, start, release, logs, returned };
}

describe("panel https", () => {
  it("refuses origins without https outside loopback", async () => {
    expect(INSECURE_ORIGIN_REFUSAL).toBe(TEXT);
    for (const origins of [
      "http://painel.exemplo.com",
      "https://a.exemplo.com,http://b.exemplo.com",
      "painel.exemplo.com",
    ]) {
      const { api, start, release, logs } = await run({
        FRIDAY_PANEL_TOKEN: TOKEN,
        FRIDAY_PANEL_ORIGINS: origins,
      });
      expect(api, origins).toBeNull();
      expect(start, origins).not.toHaveBeenCalled();
      expect(release, origins).not.toHaveBeenCalled();
      expect(logs, origins).toEqual([TEXT]);
      expect(logs.some((m) => m.includes("exemplo.com"))).toBe(false);
      db?.close();
    }
  });

  it("starts with https origins and loopback http origins", async () => {
    const origins = [
      "https://painel.exemplo.com",
      "http://127.0.0.1:7778",
      "http://localhost:5173",
      "http://[::1]:5173",
    ];
    const { api, start, logs, returned } = await run({
      FRIDAY_PANEL_TOKEN: TOKEN,
      FRIDAY_PANEL_TOKEN_EXPIRES_AT:
        new Date(Date.now() + 86_400_000).toISOString().slice(0, 19) + "Z",
      FRIDAY_PANEL_ORIGINS: origins.join(", "),
    });
    expect(start).toHaveBeenCalledTimes(1);
    const call = start.mock.calls[0] as unknown as [{ allowedOrigins: string[] }];
    expect(call[0].allowedOrigins).toEqual(origins);
    expect(api).toBe(returned);
    expect(logs).not.toContain(TEXT);
  });

  it("keeps the missing token refusal first", async () => {
    const { logs, start } = await run({ FRIDAY_PANEL_ORIGINS: "http://painel.exemplo.com" });
    expect(start).not.toHaveBeenCalled();
    expect(logs).toEqual([MISSING_TOKEN_REFUSAL]);
  });
});
