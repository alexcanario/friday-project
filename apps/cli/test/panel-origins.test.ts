import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Daemon } from "@friday/daemon";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseOrigins, startPanel, type StartApi } from "../src/daemon-panel.ts";

let db: FridayDatabase | undefined;
afterEach(() => db?.close());

const WARNING =
  "Aviso: FRIDAY_PANEL_TOKEN ausente; a leitura do painel fica aberta em 127.0.0.1. Não exponha a porta por túnel ou proxy sem o token.";

async function run(env: Record<string, string | undefined>) {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-origins-")), "friday.db"));
  const github = {} as Daemon["github"];
  const start = vi.fn(async () => ({ address: "127.0.0.1", port: 7777, close: async () => {} }));
  const logs: string[] = [];
  const daemon = { db, github, release: () => {} } as unknown as Daemon;
  await startPanel(daemon, start as unknown as StartApi, 7777, (m) => logs.push(m), env);
  const call = start.mock.calls[0] as unknown as [
    { allowedOrigins: string[]; deps: { panelToken: string | undefined } },
  ];
  return { options: call[0], logs };
}

describe("panel origins", () => {
  it("parses the origins list", () => {
    expect(parseOrigins("http://a.local, http://b.local,,")).toEqual([
      "http://a.local",
      "http://b.local",
    ]);
    expect(parseOrigins(undefined)).toEqual([]);
    expect(parseOrigins("")).toEqual([]);
  });

  it("startPanel passes the origins and the token and logs no secret", async () => {
    const { options, logs } = await run({
      FRIDAY_PANEL_TOKEN: "tok",
      FRIDAY_PANEL_ORIGINS: "http://a.local",
    });
    expect(options.allowedOrigins).toEqual(["http://a.local"]);
    expect(options.deps.panelToken).toBe("tok");
    expect(logs.some((m) => m.includes("tok"))).toBe(false);
  });

  it("startPanel warns when the panel token is missing", async () => {
    for (const env of [{}, { FRIDAY_PANEL_TOKEN: "" }]) {
      const { logs } = await run(env);
      expect(logs).toContain(WARNING);
      db?.close();
    }
    const { logs } = await run({ FRIDAY_PANEL_TOKEN: "tok" });
    expect(logs).not.toContain(WARNING);
  });
});
