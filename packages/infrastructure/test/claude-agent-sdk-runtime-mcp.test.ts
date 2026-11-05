import type { Options, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { FakeResultStore, FakeRunLookup, type AgentRunRequest } from "@friday/application";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClaudeAgentSdkRuntime,
  createFridayMcpServer,
  createResultStore,
  createRunLookup,
} from "../src/index.ts";
import type { FridayDatabase } from "../src/sqlite/database.ts";
import { runResults, runs } from "../src/sqlite/schema.ts";
import { init, makeRequest, result } from "./runtime-helpers.ts";
import { openWithProjects } from "./sqlite-fixtures.ts";

const QA_AGENT = { states: ["QA"], mcp_tools: ["qa_report"] } as const;
const QA_OK = {
  verdict: "pass",
  criteria: [{ index: 1, result: "pass", how: "pnpm test saiu 0", screenshots: [] }],
  notChecked: [],
};
const QA_BAD = { verdict: "pass", criteria: [], notChecked: [] };

type Captured = ReturnType<typeof createFridayMcpServer>;
const MESSAGES = [init(["Read", "StructuredOutput"]), result()] as SDKMessage[];

function spy(onCall?: () => Promise<void>) {
  const calls: Options[] = [];
  const query = async function* ({ options }: { prompt: string; options: Options }) {
    calls.push(options);
    if (onCall) await onCall();
    for (const m of MESSAGES) yield m;
  };
  return { calls, query };
}

function capturing() {
  const created: Captured[] = [];
  const createMcpServer = ((input: Parameters<typeof createFridayMcpServer>[0]) => {
    const c = createFridayMcpServer(input);
    created.push(c);
    return c;
  }) as typeof createFridayMcpServer;
  return { created, createMcpServer };
}

const withFriday = (
  runId = "r1",
  agent: { states: readonly string[]; mcp_tools: readonly string[] } = QA_AGENT,
  allowedTools = ["mcp__friday__qa_report"],
): AgentRunRequest => ({
  ...makeRequest({ allowedTools }),
  friday: { runId, agent: agent as never, getIssueState: () => "QA" },
});

let db: FridayDatabase | undefined;
afterEach(() => {
  db?.close();
  db = undefined;
});

function realDb(): FridayDatabase {
  db = openWithProjects("p1");
  db.orm
    .insert(runs)
    .values([
      { id: "r1", projectId: "p1", issueId: 1, finishedAt: null },
      { id: "r2", projectId: "p1", issueId: 2, finishedAt: "2026-11-05T00:00:00Z" },
    ])
    .run();
  return db;
}

describe("ClaudeAgentSdkRuntime friday server", () => {
  it("passes the friday server to the query only when the request asks", async () => {
    const s = spy();
    const runtime = new ClaudeAgentSdkRuntime({
      query: s.query,
      runs: new FakeRunLookup(["r1"]),
      results: new FakeResultStore(),
    });
    await runtime.run(withFriday());
    const servers = s.calls[0]!.mcpServers!;
    expect(Object.keys(servers)).toEqual(["friday"]);
    expect(servers.friday).toMatchObject({ type: "sdk", name: "friday" });
    expect(s.calls[0]!.strictMcpConfig).toBe(true);
    await runtime.run(makeRequest());
    expect("mcpServers" in s.calls[1]!).toBe(false);
  });

  it("is misconfigured when the request asks for the server without runs and results", async () => {
    const s = spy();
    const only = new ClaudeAgentSdkRuntime({ query: s.query, runs: new FakeRunLookup(["r1"]) });
    expect((await only.run(withFriday())).status).toBe("misconfigured");
    const none = new ClaudeAgentSdkRuntime({ query: s.query, results: new FakeResultStore() });
    expect((await none.run(withFriday())).status).toBe("misconfigured");
    expect(s.calls).toHaveLength(0);
  });

  it("consumes the single use end to end against sqlite", async () => {
    const database = realDb();
    const cap = capturing();
    const texts: string[] = [];
    const counts: number[] = [];
    const count = () => database.orm.select().from(runResults).all().length;
    const s = spy(async () => {
      const h = cap.created[0]!.handlers;
      for (const input of [QA_BAD, QA_OK, QA_OK]) {
        const r = await h.qa_report!(input);
        texts.push(`${r.isError === true ? "E" : "O"} ${r.content[0]!.text}`);
        counts.push(count());
      }
    });
    const runtime = new ClaudeAgentSdkRuntime({
      query: s.query,
      runs: createRunLookup(database),
      results: createResultStore(database),
      createMcpServer: cap.createMcpServer,
    });
    await runtime.run(withFriday());
    expect(texts).toEqual([
      "E 422: Relatório de QA com veredito pass exige ao menos um critério (criteria).",
      "O 200: resultado aceito.",
      "E 409: Resultado deste tipo já enviado nesta run.",
    ]);
    expect(counts).toEqual([0, 1, 1]);
  });

  it("exposes only the sheet tools and refuses an ended run", async () => {
    const database = realDb();
    const cap = capturing();
    let out: Awaited<ReturnType<NonNullable<Captured["handlers"]["qa_report"]>>> | undefined;
    const s = spy(async () => {
      const c = cap.created[0]!;
      expect(c.handlers.work_report).toBeUndefined();
      out = await c.handlers.qa_report!(QA_OK);
    });
    const runtime = new ClaudeAgentSdkRuntime({
      query: s.query,
      runs: createRunLookup(database),
      results: createResultStore(database),
      createMcpServer: cap.createMcpServer,
    });
    await runtime.run(withFriday("r2"));
    expect(out).toEqual({
      content: [{ type: "text", text: "404: A run não está ativa." }],
      isError: true,
    });
    expect(database.orm.select().from(runResults).all()).toHaveLength(0);
  });

  it("server tool names match the allowed mcp tools", async () => {
    const deps = { runs: new FakeRunLookup(["r1"]), results: new FakeResultStore() };
    const cap = capturing();
    const s = spy();
    const runtime = new ClaudeAgentSdkRuntime({
      query: s.query,
      ...deps,
      createMcpServer: cap.createMcpServer,
    });
    await runtime.run(withFriday());
    const friday = (o: Options) =>
      (o.allowedTools ?? []).filter((t) => t.startsWith("mcp__friday__")).sort();
    expect([...cap.created[0]!.toolNames].sort()).toEqual(["mcp__friday__qa_report"]);
    expect(friday(s.calls[0]!)).toEqual(["mcp__friday__qa_report"]);

    await runtime.run(withFriday("r1", { states: ["QA"], mcp_tools: [] }, []));
    expect(cap.created[1]!.toolNames).toEqual([]);
    expect(friday(s.calls[1]!)).toEqual([]);

    const before = { calls: s.calls.length, created: cap.created.length };
    const r = await runtime.run(withFriday("r1", QA_AGENT, ["mcp__friday__work_report"]));
    expect(r.status).toBe("misconfigured");
    expect(s.calls).toHaveLength(before.calls);
    expect(cap.created).toHaveLength(before.created);
  });

  it("is misconfigured when createMcpServer throws", async () => {
    const s = spy();
    const runtime = new ClaudeAgentSdkRuntime({
      query: s.query,
      runs: new FakeRunLookup(["r1"]),
      results: new FakeResultStore(),
      createMcpServer: () => {
        throw new Error("boom");
      },
    });
    expect((await runtime.run(withFriday())).status).toBe("misconfigured");
    expect(s.calls).toHaveLength(0);
  });
});
