import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openDatabase } from "@friday/infrastructure";
import { startDaemon } from "../src/daemon.ts";
import { panelRoot, setup, validRoot } from "./daemon-helpers.ts";

vi.mock("@friday/infrastructure", async (original) => {
  const actual = await original<typeof import("@friday/infrastructure")>();
  return { ...actual, openDatabase: vi.fn() };
});

async function realDb() {
  const actual =
    await vi.importActual<typeof import("@friday/infrastructure")>("@friday/infrastructure");
  const db = actual.openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-")), "friday.db"));
  return db;
}

type Setup = ReturnType<typeof setup>;
const optionsOf = (s: Setup) =>
  (s.startApi.mock.calls[0] as unknown as [{ port: number; deps: object }])[0];

beforeEach(() => vi.mocked(openDatabase).mockClear());

async function run(s: Setup) {
  const p = startDaemon(s.deps);
  await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
  s.fire();
  return p;
}

describe("daemon panel", () => {
  it("passes the configured port and read repositories built from daemon.db to startApi", async () => {
    const db = await realDb();
    const s = setup({ FRIDAY_HOME: validRoot() });
    s.compose.mockResolvedValue({ ...s.daemon, db } as never);
    await run(s);
    const first = optionsOf(s);
    expect(first.port).toBe(7777);
    for (const key of ["events", "issues", "runs", "ledger", "approvals"]) {
      expect(first.deps, key).toHaveProperty(key);
    }
    expect(typeof (first.deps as { now: unknown }).now).toBe("function");
    expect(openDatabase).not.toHaveBeenCalled();

    const s2 = setup({ FRIDAY_HOME: panelRoot(9000) });
    await run(s2);
    expect(optionsOf(s2).port).toBe(9000);
  });

  it("starts the api between compose and the ticker and logs the panel url without secrets", async () => {
    const lines: string[] = [];
    const s = setup(
      { FRIDAY_HOME: validRoot(), FRIDAY_PANEL_TOKEN: "tok-secret-123" },
      { log: (m: string) => void lines.push(m) },
    );
    s.compose.mockImplementation(async () => {
      s.order.push("compose");
      return s.daemon;
    });
    s.startApi.mockImplementation(async () => {
      s.order.push("api-start");
      return { address: "127.0.0.1", port: 7777, close: s.apiClose };
    });
    s.start.mockImplementation(() => {
      s.order.push("ticker-start");
      return s.stop;
    });
    await run(s);
    expect(s.order.slice(0, 3)).toEqual(["compose", "api-start", "ticker-start"]);
    expect(lines.filter((l) => /^Painel em http:\/\/127\.0\.0\.1:\d+$/.test(l))).toHaveLength(1);
    expect(lines.filter((l) => l.startsWith("Painel"))).toHaveLength(1);
    expect(lines.some((l) => l.includes("tok-secret-123"))).toBe(false);
  });

  it("names the port on EADDRINUSE and releases without starting the ticker", async () => {
    const s = setup({ FRIDAY_HOME: validRoot() });
    s.startApi.mockRejectedValue(Object.assign(new Error("listen"), { code: "EADDRINUSE" }));
    expect(await startDaemon(s.deps)).toEqual({
      stdout: "",
      stderr: "A porta 7777 do painel já está em uso.\n",
      code: 1,
    });
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.start).not.toHaveBeenCalled();

    const s2 = setup({ FRIDAY_HOME: validRoot() });
    s2.startApi.mockRejectedValue(new Error("boom"));
    expect(await startDaemon(s2.deps)).toEqual({ stdout: "", stderr: "boom\n", code: 1 });
    expect(s2.release).toHaveBeenCalledTimes(1);
    expect(s2.start).not.toHaveBeenCalled();
  });
});
