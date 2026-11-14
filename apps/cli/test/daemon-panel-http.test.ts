import { mkdtempSync } from "node:fs";
import { createServer, type AddressInfo, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { startApi as realStartApi, type RunningApi, type StartApiOptions } from "@friday/api";
import {
  createEventStore,
  createIssueRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { startDaemon } from "../src/daemon.ts";
import { setup, validRoot } from "./daemon-helpers.ts";

function openTemp(): FridayDatabase {
  const db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-panel-http-")), "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("p1");
  createEventStore(db).append({
    projectId: "p1",
    issueId: 14,
    runId: null,
    type: "StateChanged",
    payload: {
      type: "StateChanged",
      issueId: "14",
      from: "Todo",
      to: "InProgress",
      trigger: "Admitted",
      heldReason: null,
      verifyRound: 1,
      qaRound: 2,
      reviewIter: 3,
    },
    actor: "test",
    at: "2026-11-05T10:00:00.000Z",
  });
  createIssueRepository(db).rebuild("p1");
  return db;
}

const servers: Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function forced(port: number, seen: RunningApi[] = []) {
  return async (options: StartApiOptions) => {
    const api = await realStartApi({ ...options, port });
    seen.push(api);
    return api;
  };
}

async function started(s: ReturnType<typeof setup>, seen: RunningApi[]) {
  const p = startDaemon(s.deps);
  await vi.waitFor(() => expect(seen).toHaveLength(1));
  await vi.waitFor(() => expect(s.start).toHaveBeenCalled());
  return p;
}

describe("daemon panel over http", () => {
  it("serves /health and reads the daemon database while running", async () => {
    const seen: RunningApi[] = [];
    const s = setup({ FRIDAY_HOME: validRoot() }, { startApi: forced(0, seen) as never });
    s.compose.mockResolvedValue({ ...s.daemon, db: openTemp() } as never);
    const p = await started(s, seen);
    const base = `http://127.0.0.1:${seen[0]?.port}`;
    expect((await fetch(`${base}/health`)).status).toBe(200);
    const res = await fetch(`${base}/issues?project=p1`);
    expect(res.status).toBe(200);
    const body: unknown = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(JSON.stringify(body)).toContain("14");
    s.fire();
    await p;
  });

  it("fails startup with exit 1 when the port is busy", async () => {
    const blocker = createServer();
    servers.push(blocker);
    await new Promise<void>((ok) => blocker.listen(0, "127.0.0.1", ok));
    const port = (blocker.address() as AddressInfo).port;
    const s = setup({ FRIDAY_HOME: validRoot() }, { startApi: forced(port) as never });
    s.compose.mockResolvedValue({ ...s.daemon, db: openTemp() } as never);
    const out = await startDaemon(s.deps);
    expect(out.code).toBe(1);
    expect(out.stderr).toContain("já está em uso");
    expect(s.release).toHaveBeenCalledTimes(1);
    expect(s.start).not.toHaveBeenCalled();
  });

  it("closes the api before release and refuses connections after shutdown", async () => {
    const seen: RunningApi[] = [];
    const s = setup({ FRIDAY_HOME: validRoot() }, { startApi: forced(0, seen) as never });
    s.compose.mockResolvedValue({ ...s.daemon, db: openTemp() } as never);
    const p = await started(s, seen);
    const url = `http://127.0.0.1:${seen[0]?.port}/health`;
    s.fire();
    expect((await p).code).toBe(0);
    expect(s.order).toEqual(["stop", "idle", "release"]);
    await expect(fetch(url)).rejects.toThrow();
  });
});
