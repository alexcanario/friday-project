import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRecord } from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createIssueRepository,
  openDatabase,
} from "@friday/infrastructure";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runApprovals } from "../src/approvals.ts";
import { createProductionOpen, resolveConfigRoot } from "../src/production-client.ts";

const T0 = 1_000_000;
const A = "a".repeat(40);
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const fixture = join(repoRoot, "packages/infrastructure/test/fixtures/valid");

const tmp = (name: string) => mkdtempSync(join(tmpdir(), `friday-${name}-`));

function makeRoot(renamed: boolean, withoutAuthor = false): string {
  const dir = tmp("root");
  cpSync(fixture, dir, { recursive: true });
  const file = join(dir, "factory.yaml");
  const line = "  author_token_env: FRIDAY_AUTHOR_TOKEN\n";
  let text = readFileSync(file, "utf8");
  if (withoutAuthor) text = text.replace(line, "");
  else if (renamed) text = text.replace(line, "  author_token_env: TEST_AUTHOR_TOKEN\n");
  writeFileSync(file, text);
  return dir;
}

let head: string;
let headFails: boolean;
let calls: { token: string; repo: { owner: string; repo: string } }[];
let merges: [number, string][];
let headCalls: number[];

const createGitHub = (token: string, repo: { owner: string; repo: string }) => {
  calls.push({ token, repo });
  return {
    squashMerge: async (pr: number, sha: string) => {
      merges.push([pr, sha]);
      return { merged: true as const, sha: "m1" };
    },
    getPrMergeState: async (pr: number) => {
      headCalls.push(pr);
      if (headFails) throw new Error("x");
      return { merged: false, headSha: head } as never;
    },
  };
};

beforeEach(() => {
  head = A;
  headFails = false;
  calls = [];
  merges = [];
  headCalls = [];
  vi.useFakeTimers();
  vi.setSystemTime(T0 + 1000);
});
afterEach(() => vi.useRealTimers());

function seed(dbPath: string) {
  const db = openDatabase(dbPath);
  db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p1')").run();
  const record: ApprovalRecord = {
    id: "00000001",
    projectId: "p1",
    issueId: 7,
    pr: 30,
    headSha: A,
    tier: "high",
    requestedAt: T0,
    expiresAt: T0 + 1_800_000,
    decision: null,
    decidedAt: null,
    decidedBy: null,
  };
  createApprovalStore(db).insert(record);
  createEventStore(db).append({
    projectId: "p1",
    issueId: 7,
    runId: null,
    type: "StateChanged",
    actor: "seed",
    at: "2026-11-05T00:00:00Z",
    payload: {
      type: "StateChanged",
      issueId: "7",
      from: "RiskCheck",
      to: "AwaitingApproval",
      trigger: "RiskAssessed",
      heldReason: null,
      verifyRound: 0,
      qaRound: 0,
      reviewIter: 0,
    },
  });
  createIssueRepository(db).rebuild("p1");
  db.close();
}

const newDb = () => join(tmp("db"), "friday.db");
const open = (env: Record<string, string>) =>
  createProductionOpen({ env, homeDir: tmp("home"), createGitHub });

describe("friday approvals production client", () => {
  it("resolves the config root from FRIDAY_HOME or the home folder and opens nothing until first use", () => {
    expect(resolveConfigRoot({ env: { FRIDAY_HOME: "/r" }, homeDir: "/h" })).toBe("/r");
    expect(resolveConfigRoot({ env: { FRIDAY_HOME: "" }, homeDir: "/h" })).toBe(
      join("/h", ".friday"),
    );
    expect(resolveConfigRoot({ env: {}, homeDir: "/h" })).toBe(join("/h", ".friday"));
    const dbPath = newDb();
    const client = open({ FRIDAY_HOME: makeRoot(true), TEST_AUTHOR_TOKEN: "tok-123" })(dbPath);
    expect(typeof client.list).toBe("function");
    expect(typeof client.decide).toBe("function");
    expect(typeof client.close).toBe("function");
    expect(existsSync(dbPath)).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("lists approvals without a token or factory.yaml", async () => {
    const dbPath = newDb();
    seed(dbPath);
    const client = open({ FRIDAY_HOME: tmp("empty") })(dbPath);
    const items = await client.list("p1");
    expect(items.map((i) => i.id)).toEqual(["00000001"]);
    expect(calls).toHaveLength(0);
    client.close?.();
    await expect(client.list("p1")).rejects.toThrow();
    const fresh = newDb();
    const c2 = open({ FRIDAY_HOME: tmp("empty") })(fresh);
    expect(await c2.list("p1")).toEqual([]);
    expect(existsSync(fresh)).toBe(true);
    c2.close?.();
  }, 30_000);

  it("approves and denies end to end as human:cli with the token from the configured or default variable", async () => {
    const dbPath = newDb();
    seed(dbPath);
    const client = open({ FRIDAY_HOME: makeRoot(true), TEST_AUTHOR_TOKEN: "tok-123" })(dbPath);
    expect(await client.decide("00000001", "approve")).toEqual({ kind: "merged", sha: "m1" });
    client.close?.();
    expect(calls).toEqual([
      { token: "tok-123", repo: { owner: "alexcanario", repo: "friday-sandbox" } },
    ]);
    expect(merges).toEqual([[30, A]]);
    const db = openDatabase(dbPath);
    expect(createApprovalStore(db).get("00000001")?.decidedBy).toBe("human:cli");
    expect(createIssueRepository(db).get("p1", 7)?.state).toBe("Done");
    db.close();

    calls = [];
    const d2 = newDb();
    seed(d2);
    const c2 = open({ FRIDAY_HOME: makeRoot(false), FRIDAY_AUTHOR_TOKEN: "tok-default" })(d2);
    await c2.decide("00000001", "approve");
    c2.close?.();
    expect(calls).toEqual([
      { token: "tok-default", repo: { owner: "alexcanario", repo: "friday-sandbox" } },
    ]);

    merges = [];
    const d3 = newDb();
    seed(d3);
    const c3 = open({ FRIDAY_HOME: makeRoot(true), TEST_AUTHOR_TOKEN: "tok-123" })(d3);
    expect(await c3.decide("00000001", "deny")).toEqual({ kind: "denied" });
    c3.close?.();
    expect(merges).toHaveLength(0);
  }, 30_000);

  it("reads the pr head from getPrMergeState and refuses on head_changed", async () => {
    const dbPath = newDb();
    seed(dbPath);
    head = "b".repeat(40);
    const client = open({ FRIDAY_HOME: makeRoot(true), TEST_AUTHOR_TOKEN: "tok-123" })(dbPath);
    expect(await client.decide("00000001", "approve")).toEqual({ kind: "head_changed" });
    client.close?.();
    expect(merges).toHaveLength(0);
    expect(headCalls).toEqual([30]);
  }, 30_000);

  it("decide fails closed without creating the database when config or token is missing", async () => {
    const withName = makeRoot(true);
    const noName = makeRoot(false);
    const cases: [Record<string, string>, string][] = [
      [{ FRIDAY_HOME: tmp("empty") }, "O factory.yaml está inválido ou ausente."],
      [{ FRIDAY_HOME: makeRoot(false, true) }, "O factory.yaml está inválido ou ausente."],
      [{ FRIDAY_HOME: noName }, "A variável FRIDAY_AUTHOR_TOKEN está vazia ou ausente."],
      [{ FRIDAY_HOME: withName }, "A variável TEST_AUTHOR_TOKEN está vazia ou ausente."],
      [
        { FRIDAY_HOME: withName, TEST_AUTHOR_TOKEN: "   " },
        "A variável TEST_AUTHOR_TOKEN está vazia ou ausente.",
      ],
    ];
    for (const [env, message] of cases) {
      for (const decision of ["approve", "deny"] as const) {
        const dbPath = newDb();
        const client = open(env)(dbPath);
        await expect(client.decide("00000001", decision)).rejects.toThrow(new Error(message));
        expect(existsSync(dbPath)).toBe(false);
        expect(calls).toHaveLength(0);
        expect(() => client.close?.()).not.toThrow();
      }
    }
  }, 30_000);

  it("never leaks the token and reports a generic failure through runApprovals", async () => {
    const root = makeRoot(true);
    const blank = open({ FRIDAY_HOME: root, TEST_AUTHOR_TOKEN: "   " });
    const dbA = newDb();
    expect(await runApprovals(["approvals", "approve", "00000001", "--db", dbA], blank)).toEqual({
      stdout: "",
      stderr: "Falha ao decidir a aprovação.\n",
      code: 1,
    });

    const good = open({ FRIDAY_HOME: root, TEST_AUTHOR_TOKEN: "tok-123" });
    const dbB = newDb();
    seed(dbB);
    headFails = true;
    const out = await runApprovals(["approvals", "approve", "00000001", "--db", dbB], good);
    expect(out.code).toBe(1);
    expect(out.stdout).not.toContain("tok-123");
    expect(out.stderr).not.toContain("tok-123");

    const dbC = newDb();
    expect(await runApprovals(["approvals", "list", "--db", dbC, "--project", "p1"], good)).toEqual(
      { stdout: "Nenhuma aprovação pendente.\n", stderr: "", code: 0 },
    );
  }, 30_000);

  it("routes approve and deny in index.ts through the production open", () => {
    const root = makeRoot(true);
    for (const verb of ["approve", "deny"]) {
      const dbPath = newDb();
      const r = spawnSync(
        process.execPath,
        ["apps/cli/src/index.ts", "approvals", verb, "00000001", "--db", dbPath],
        { cwd: repoRoot, encoding: "utf8", env: { PATH: process.env.PATH, FRIDAY_HOME: root } },
      );
      expect({ stdout: r.stdout, stderr: r.stderr, code: r.status }).toEqual({
        stdout: "",
        stderr: "Falha ao decidir a aprovação.\n",
        code: 1,
      });
      expect(existsSync(dbPath)).toBe(false);
    }
  }, 30_000);
});
