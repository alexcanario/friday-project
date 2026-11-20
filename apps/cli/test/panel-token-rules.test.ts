import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Daemon } from "@friday/daemon";
import { openDatabase, type FridayDatabase } from "@friday/infrastructure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  apiDepsOf,
  MISSING_TOKEN_REFUSAL,
  startPanel,
  type StartApi,
} from "../src/daemon-panel.ts";
import { runDaemonCommand } from "../src/daemon.ts";
import {
  EXPIRY_INVALID_REFUSAL,
  EXPIRY_REQUIRED_REFUSAL,
  INSECURE_ORIGIN_REFUSAL,
  INVALID_TOKEN_REFUSAL,
} from "../src/panel-checks.ts";
import { setup, validRoot } from "./daemon-helpers.ts";

let db: FridayDatabase | undefined;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-20T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  db?.close();
});

const VALID_TOKEN = "A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6";
const PUBLIC = "https://painel.exemplo.com";
const EXPIRES = "FRIDAY_PANEL_TOKEN_EXPIRES_AT";

const INVALID_TOKEN_TEXT =
  "Painel não iniciado: FRIDAY_PANEL_TOKEN deve ter só letras e números (A-Z, a-z, 0-9) e pelo menos 32 caracteres. Gere outro valor e reinicie o daemon; o daemon continua rodando sem o painel.";
const EXPIRY_REQUIRED_TEXT =
  "Painel não iniciado: com origem fora do loopback, FRIDAY_PANEL_TOKEN_EXPIRES_AT é obrigatória (data e hora UTC, por exemplo 2026-12-20T00:00:00Z). Defina e reinicie o daemon; o daemon continua rodando sem o painel.";
const EXPIRY_INVALID_TEXT =
  "Painel não iniciado: FRIDAY_PANEL_TOKEN_EXPIRES_AT deve ser uma data e hora UTC no formato AAAA-MM-DDTHH:MM:SSZ, no futuro e a no máximo 90 dias. Corrija e reinicie o daemon; o daemon continua rodando sem o painel.";

async function run(env: Record<string, string | undefined>) {
  db?.close();
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-rules-")), "friday.db"));
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
  return { api, start, release, logs };
}

describe("panel token rules", () => {
  it("has the exact refusal texts", () => {
    expect(INVALID_TOKEN_REFUSAL).toBe(INVALID_TOKEN_TEXT);
    expect(EXPIRY_REQUIRED_REFUSAL).toBe(EXPIRY_REQUIRED_TEXT);
    expect(EXPIRY_INVALID_REFUSAL).toBe(EXPIRY_INVALID_TEXT);
  });

  it("refuses a token outside the format rule and keeps the check order", async () => {
    for (const token of ["curto", "A".repeat(31) + '"']) {
      const { api, start, release, logs } = await run({ FRIDAY_PANEL_TOKEN: token });
      expect(api).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(release).not.toHaveBeenCalled();
      expect(logs).toEqual([INVALID_TOKEN_TEXT]);
      expect(logs.some((m) => m.includes(token))).toBe(false);
    }
    const ok = await run({ FRIDAY_PANEL_TOKEN: VALID_TOKEN });
    expect(ok.start).toHaveBeenCalledTimes(1);

    const missing = await run({ FRIDAY_PANEL_ORIGINS: PUBLIC, FRIDAY_PANEL_TOKEN: "" });
    expect(missing.logs).toEqual([MISSING_TOKEN_REFUSAL]);

    const bothBad = await run({
      FRIDAY_PANEL_TOKEN: "curto",
      FRIDAY_PANEL_ORIGINS: "http://painel.exemplo.com",
    });
    expect(bothBad.logs).toEqual([INVALID_TOKEN_TEXT]);

    const insecure = await run({
      FRIDAY_PANEL_TOKEN: VALID_TOKEN,
      FRIDAY_PANEL_ORIGINS: "http://painel.exemplo.com",
    });
    expect(insecure.start).not.toHaveBeenCalled();
    expect(insecure.logs).toEqual([INSECURE_ORIGIN_REFUSAL]);
  });

  it("keeps the daemon running when the token format is refused", async () => {
    const lines: string[] = [];
    const s = setup(
      { FRIDAY_HOME: validRoot(), FRIDAY_PANEL_TOKEN: 'a"b' },
      { log: (m) => void lines.push(m) },
    );
    const p = runDaemonCommand(["daemon"], s.deps);
    await vi.waitFor(() => expect(s.start).toHaveBeenCalledTimes(1));
    s.fire();
    expect(await p).toEqual({ stdout: "", stderr: "", code: 0 });
    expect(s.startApi).not.toHaveBeenCalled();
    expect(lines).toContain(INVALID_TOKEN_TEXT);
  });

  it("requires an expiry date with a public origin only, empty counts as absent", async () => {
    for (const expires of [undefined, ""]) {
      const { api, start, logs } = await run({
        FRIDAY_PANEL_ORIGINS: PUBLIC,
        FRIDAY_PANEL_TOKEN: VALID_TOKEN,
        [EXPIRES]: expires,
      });
      expect(api).toBeNull();
      expect(start).not.toHaveBeenCalled();
      expect(logs).toEqual([EXPIRY_REQUIRED_TEXT]);
      expect(logs.some((m) => m.includes(PUBLIC))).toBe(false);
    }
    for (const origins of ["http://127.0.0.1:7778", undefined]) {
      for (const expires of [undefined, ""]) {
        const { start } = await run({
          FRIDAY_PANEL_ORIGINS: origins,
          FRIDAY_PANEL_TOKEN: VALID_TOKEN,
          [EXPIRES]: expires,
        });
        expect(start, `${origins}/${expires}`).toHaveBeenCalledTimes(1);
      }
    }
  });

  it("accepts only a future UTC date within 90 days", async () => {
    for (const value of [
      "amanhã",
      "2026-12-20",
      "2026-12-20T00:00:00+01:00",
      "2026-02-31T00:00:00Z",
      "2026-11-19T00:00:00Z",
      "2026-11-20T12:00:00Z",
      "2027-03-01T00:00:00Z",
    ]) {
      const { api, start, logs } = await run({
        FRIDAY_PANEL_ORIGINS: PUBLIC,
        FRIDAY_PANEL_TOKEN: VALID_TOKEN,
        [EXPIRES]: value,
      });
      expect(api, value).toBeNull();
      expect(start, value).not.toHaveBeenCalled();
      expect(logs, value).toEqual([EXPIRY_INVALID_TEXT]);
      expect(logs.some((m) => m.includes(value))).toBe(false);
    }
    for (const value of ["2026-12-20T00:00:00Z", "2027-02-18T12:00:00Z"]) {
      const { start } = await run({
        FRIDAY_PANEL_ORIGINS: PUBLIC,
        FRIDAY_PANEL_TOKEN: VALID_TOKEN,
        [EXPIRES]: value,
      });
      expect(start, value).toHaveBeenCalledTimes(1);
    }
    const noOrigins = await run({ FRIDAY_PANEL_TOKEN: VALID_TOKEN, [EXPIRES]: "amanhã" });
    expect(noOrigins.logs).toEqual([EXPIRY_INVALID_TEXT]);
    expect(noOrigins.start).not.toHaveBeenCalled();
  });

  it("wires the expiry date into the api deps", async () => {
    db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-rules-")), "friday.db"));
    const daemon = { db, github: {} } as unknown as Pick<Daemon, "db" | "github">;
    expect(apiDepsOf(daemon, { [EXPIRES]: "2026-12-20T00:00:00Z" }).panelTokenExpiresAt).toBe(
      Date.parse("2026-12-20T00:00:00Z"),
    );
    for (const value of [undefined, "", "amanhã"]) {
      expect(apiDepsOf(daemon, { [EXPIRES]: value }).panelTokenExpiresAt).toBeUndefined();
    }
  });

  it("warns 7 days or less before the expiry", async () => {
    const warned = await run({
      FRIDAY_PANEL_TOKEN: VALID_TOKEN,
      [EXPIRES]: "2026-11-25T00:00:00Z",
    });
    const warning =
      "Aviso: FRIDAY_PANEL_TOKEN expira em 5 dia(s). Gere outro token e reinicie o daemon.";
    expect(warned.logs).toEqual([warning, "Painel em http://127.0.0.1:7777"]);

    const far = await run({ FRIDAY_PANEL_TOKEN: VALID_TOKEN, [EXPIRES]: "2026-11-30T00:00:00Z" });
    expect(far.logs.some((m) => m.startsWith("Aviso: FRIDAY_PANEL_TOKEN expira"))).toBe(false);
    expect(far.logs).toEqual(["Painel em http://127.0.0.1:7777"]);
  });
});
