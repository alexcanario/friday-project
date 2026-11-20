import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Daemon } from "@friday/daemon";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPanel, type StartApi } from "../src/daemon-panel.ts";
import { runDaemonCommand } from "../src/daemon.ts";
import { setup, validRoot } from "./daemon-helpers.ts";

let db: FridayDatabase | undefined;
afterEach(() => db?.close());

const REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_ORIGINS está definida, mas FRIDAY_PANEL_TOKEN está ausente ou vazia. Defina FRIDAY_PANEL_TOKEN e reinicie o daemon; o daemon continua rodando sem o painel.";
const WARNING =
  "Aviso: FRIDAY_PANEL_TOKEN ausente; a leitura do painel fica aberta em 127.0.0.1. Não exponha a porta por túnel ou proxy sem o token.";

async function run(env: Record<string, string | undefined>) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-closed-")), "friday.db"));
  const github = {} as Daemon["github"];
  const start = vi.fn(async () => ({ address: "127.0.0.1", port: 7777, close: async () => {} }));
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
  return { api, start, release, logs };
}

describe("panel fails closed", () => {
  it("refuses to start the panel with origins and no token", async () => {
    for (const token of [undefined, ""]) {
      const { api, start, release, logs } = await run({
        FRIDAY_PANEL_ORIGINS: "http://a.local",
        FRIDAY_PANEL_TOKEN: token,
      });
      expect(api).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(logs).toEqual([REFUSAL]);
      db?.close();
    }
  });

  it("logs no variable value and keeps the open-read warning without origins", async () => {
    const refused = await run({
      FRIDAY_PANEL_ORIGINS: "http://segredo-origem.local",
      FRIDAY_PANEL_TOKEN: "",
    });
    expect(refused.logs.some((m) => m.includes("segredo-origem.local"))).toBe(false);
    db?.close();
    const open = await run({ FRIDAY_PANEL_ORIGINS: " , " });
    expect(open.start).toHaveBeenCalledTimes(1);
    expect(open.logs).toContain(WARNING);
    expect(open.logs).not.toContain(REFUSAL);
  });

  it("starts the panel with origins and a token", async () => {
    const { api, start, logs } = await run({
      FRIDAY_PANEL_TOKEN: "tok",
      FRIDAY_PANEL_ORIGINS: "https://a.local",
    });
    expect(start).toHaveBeenCalledTimes(1);
    const call = start.mock.calls[0] as unknown as [{ allowedOrigins: string[] }];
    expect(call[0].allowedOrigins).toEqual(["https://a.local"]);
    expect(api).not.toBeNull();
    expect(logs).not.toContain(REFUSAL);
    expect(logs).not.toContain(WARNING);
  });
});

describe("daemon with a refused panel", () => {
  it("keeps the daemon running when the panel is refused", async () => {
    const lines: string[] = [];
    const s = setup(
      { FRIDAY_HOME: validRoot(), FRIDAY_PANEL_ORIGINS: "http://a.local" },
      { log: (m) => void lines.push(m) },
    );
    const p = runDaemonCommand(["daemon"], s.deps);
    await vi.waitFor(() => expect(s.start).toHaveBeenCalledTimes(1));
    s.fire();
    expect(await p).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(s.startApi).not.toHaveBeenCalled();
    expect(lines).toContain(REFUSAL);
    expect(lines.some((m) => m.startsWith("Painel em"))).toBe(false);
    expect(s.release).toHaveBeenCalledTimes(1);
  });

  it("still starts and closes the panel with origins and a token", async () => {
    const lines: string[] = [];
    const s = setup(
      {
        FRIDAY_HOME: validRoot(),
        FRIDAY_PANEL_TOKEN: "tok",
        FRIDAY_PANEL_ORIGINS: "https://a.local",
      },
      { log: (m) => void lines.push(m) },
    );
    const p = runDaemonCommand(["daemon"], s.deps);
    await vi.waitFor(() => expect(s.start).toHaveBeenCalledTimes(1));
    s.fire();
    await p;
    expect(s.startApi).toHaveBeenCalledTimes(1);
    expect(lines.filter((m) => m.startsWith("Painel em"))).toEqual([
      "Painel em http://127.0.0.1:7777",
    ]);
    expect(s.apiClose).toHaveBeenCalled();
  });
});
