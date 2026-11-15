import type { LedgerEntry } from "@friday/application";
import type { FastifyInstance } from "fastify";
import { afterEach, describe, expect, it } from "vitest";
import { buildApp } from "../src/index.ts";
import { openFixture, stateChanged, type Fixture } from "./helpers.ts";

let f: Fixture;
let app: FastifyInstance;
let ctrl: AbortController;
const ctrls: AbortController[] = [];

afterEach(async () => {
  for (const c of ctrls.splice(0)) c.abort();
  await app?.close();
  f.db.close();
});

interface Stream {
  res: Response;
  text: () => string;
  waitFor: (needle: string, from?: number) => Promise<number>;
}

async function start(headers: Record<string, string> = {}, project = "p1"): Promise<Stream> {
  if (!app.server.listening) await app.listen({ host: "127.0.0.1", port: 0 });
  const addr = app.server.address() as { port: number };
  ctrl = new AbortController();
  ctrls.push(ctrl);
  const res = await fetch(`http://127.0.0.1:${addr.port}/events/stream?project=${project}`, {
    headers,
    signal: ctrl.signal,
  });
  let buf = "";
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  void (async () => {
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buf += decoder.decode(value, { stream: true });
      }
    } catch {
      // aborted by the test
    }
  })();
  const waitFor = async (needle: string, from = 0): Promise<number> => {
    const limit = Date.now() + 2000;
    while (Date.now() < limit) {
      const i = buf.indexOf(needle, from);
      if (i >= 0) return i + needle.length;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error(`timeout waiting for ${needle}; got ${buf}`);
  };
  return { res, text: () => buf, waitFor };
}

async function boot(): Promise<void> {
  f = openFixture();
  app = await buildApp({ ...f.deps, ssePollMs: 20 });
}

const finished = (issueId: number, runId: string) => ({
  projectId: "p1",
  issueId,
  runId,
  type: "RunFinished",
  payload: {
    status: "succeeded",
    subtype: null,
    model: null,
    costUsd: null,
    tokens: null,
    numTurns: null,
    durationMs: null,
    output: null,
    violations: [],
  },
  actor: "test",
  at: "2026-11-05T10:00:00.000Z",
});

const note = (projectId: string) => ({
  projectId,
  issueId: 14,
  runId: null,
  type: "Note",
  payload: { text: "x" },
  actor: "test",
  at: "2026-11-05T10:00:00.000Z",
});

function ledger(runId: string, costUsd: number | null): void {
  const entry: LedgerEntry = {
    projectId: "p1",
    runId,
    day: "2026-11-05",
    costUsd,
    costUnknown: costUsd === null,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    issueId: 14,
    numTurns: null,
  };
  f.deps.runs.save({
    id: runId,
    projectId: "p1",
    issueId: 14,
    phase: null,
    startedAt: null,
    finishedAt: null,
    status: "running",
  });
  f.deps.ledger.record(entry);
}

const cost = (usd: number, unknown = false) =>
  `data: {"issueId":14,"costUsd":${usd},"anyCostUnknown":${unknown}}\n\n`;

describe("GET /events/stream", () => {
  it("answers with the event-stream headers", async () => {
    await boot();
    const s = await start();
    expect(s.res.status).toBe(200);
    expect(s.res.headers.get("content-type")).toMatch(/^text\/event-stream/);
    expect(s.res.headers.get("cache-control")).toBe("no-cache");
  });

  it("sends stage_changed within 2 seconds of the write", async () => {
    await boot();
    const s = await start();
    const e = f.deps.events.append(stateChanged("p1", 14, "Todo", "InProgress"));
    await s.waitFor(
      `id: ${e.seq}\nevent: stage_changed\ndata: {"issueId":14,"from":"Todo","to":"InProgress","heldReason":null}\n\n`,
    );
    f.deps.events.append(stateChanged("p1", 14, "InProgress", "Held", "budget"));
    await s.waitFor(`"to":"Held","heldReason":"budget"}`);
  });

  it("sends run_finished then cost_updated again when the ledger row arrives later", async () => {
    await boot();
    const s = await start();
    const e = f.deps.events.append(finished(14, "r1"));
    const a = await s.waitFor(
      `id: ${e.seq}\nevent: run_finished\ndata: {"issueId":14,"runId":"r1"}\n\n`,
    );
    const b = await s.waitFor(`event: cost_updated\n${cost(0)}`, a);
    ledger("r1", 0.5);
    const c = await s.waitFor(`event: cost_updated\n${cost(0.5)}`, b);
    expect(s.text()).not.toMatch(/id: \d+\nevent: cost_updated/);
    f.deps.events.append(finished(14, "r2"));
    const d = await s.waitFor(`event: run_finished\ndata: {"issueId":14,"runId":"r2"}\n\n`, c);
    const g = await s.waitFor(`event: cost_updated\n${cost(0.5)}`, d);
    ledger("r2", 0.25);
    const h = await s.waitFor(`event: cost_updated\n${cost(0.75)}`, g);
    ledger("r3", null);
    await s.waitFor(`event: cost_updated\n${cost(0.75, true)}`, h);
  });

  it("ignores other projects and unlisted event types", async () => {
    await boot();
    const s = await start();
    f.deps.events.append(stateChanged("p2", 14, "Todo", "InProgress"));
    f.deps.events.append(note("p1"));
    await new Promise((r) => setTimeout(r, 200));
    expect(s.text()).not.toContain("event:");
    f.deps.events.append(stateChanged("p1", 15, "Todo", "InProgress"));
    await s.waitFor(`event: stage_changed\ndata: {"issueId":15,`);
  });

  it("resumes after Last-Event-ID and skips old events without it", async () => {
    await boot();
    const old = [14, 15, 16].map((n) =>
      f.deps.events.append(stateChanged("p1", n, "Todo", "InProgress")),
    );
    const s = await start({ "Last-Event-ID": String(old[0]!.seq) });
    const end = await s.waitFor(`id: ${old[2]!.seq}\nevent: stage_changed`);
    const first = s.text().indexOf(`id: ${old[1]!.seq}\n`);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThan(end);
    expect(s.text()).not.toContain(`id: ${old[0]!.seq}\n`);
    ctrl.abort();

    const none = await start();
    const bad = await start({ "Last-Event-ID": "abc" });
    expect(bad.res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 200));
    expect(none.text()).not.toContain("event:");
    expect(bad.text()).not.toContain("event:");
  });

  it("rejects a missing or empty project with 400", async () => {
    await boot();
    for (const url of ["/events/stream", "/events/stream?project="]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, url).toBe(400);
    }
  });

  it("stops polling when the client disconnects", async () => {
    await boot();
    await start();
    ctrl.abort();
    await new Promise((r) => setTimeout(r, 100));
    const t0 = Date.now();
    await app.close();
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
