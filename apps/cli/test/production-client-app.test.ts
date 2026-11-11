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
import { createProductionOpen } from "../src/production-client.ts";

const T0 = 1_000_000;
const A = "a".repeat(40);
const repoRoot = join(import.meta.dirname, "..", "..", "..");
const fixture = join(repoRoot, "packages/infrastructure/test/fixtures/valid");
const ENV_LINE = "  author_token_env: FRIDAY_AUTHOR_TOKEN\n";
const APP_BLOCK =
  "  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: /etc/friday/author.pem\n";

const tmp = (name: string) => mkdtempSync(join(tmpdir(), `friday-${name}-`));

function makeRoot(pullRequests: string): string {
  const dir = tmp("root");
  cpSync(fixture, dir, { recursive: true });
  const file = join(dir, "factory.yaml");
  writeFileSync(file, readFileSync(file, "utf8").replace(ENV_LINE, pullRequests));
  return dir;
}

let merges: [number, string][];
let tokens: string[];
const tokenSpy = vi.fn();
const withAuthSpy = vi.fn();
const githubSpy = vi.fn();

const fakeGitHub = () => ({
  squashMerge: async (pr: number, sha: string) => {
    merges.push([pr, sha]);
    return { merged: true as const, sha: "m1" };
  },
  getPrMergeState: async () => ({ merged: false, headSha: A }) as never,
});

beforeEach(() => {
  merges = [];
  tokens = ["tok-1", "tok-2"];
  tokenSpy.mockReset().mockImplementation(() => ({
    getToken: async () => tokens.shift() ?? "tok-n",
  }));
  withAuthSpy.mockReset().mockImplementation(() => fakeGitHub());
  githubSpy.mockReset().mockImplementation(() => fakeGitHub());
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
  createProductionOpen({
    env,
    homeDir: tmp("home"),
    createTokenProvider: tokenSpy,
    createGitHubWithAuth: withAuthSpy,
    createGitHub: githubSpy,
  });

describe("friday approvals production client with author_app", () => {
  it("approvals client takes the token from the installation provider", async () => {
    const dbPath = newDb();
    seed(dbPath);
    const client = open({ FRIDAY_HOME: makeRoot(APP_BLOCK) })(dbPath);
    expect(await client.decide("00000001", "approve")).toEqual({ kind: "merged", sha: "m1" });
    client.close?.();
    expect(tokenSpy.mock.calls).toEqual([
      [{ appId: 1, installationId: 2, privateKeyPath: "/etc/friday/author.pem" }],
    ]);
    expect(withAuthSpy).toHaveBeenCalledTimes(1);
    const [auth, repo] = withAuthSpy.mock.calls[0] as [() => Promise<string>, unknown];
    expect(repo).toEqual({ owner: "alexcanario", repo: "friday-sandbox" });
    expect(await auth()).toBe("tok-1");
    expect(githubSpy).not.toHaveBeenCalled();
    expect(merges).toEqual([[30, A]]);
  });

  it("approvals client asks the provider on every request and ignores the author env", async () => {
    const dbPath = newDb();
    seed(dbPath);
    const env = { FRIDAY_HOME: makeRoot(APP_BLOCK), FRIDAY_AUTHOR_TOKEN: "x" };
    const client = open(env)(dbPath);
    await client.decide("00000001", "approve");
    client.close?.();
    const [auth] = withAuthSpy.mock.calls[0] as [() => Promise<string>];
    expect(await auth()).toBe("tok-1");
    expect(await auth()).toBe("tok-2");
    expect(tokenSpy).toHaveBeenCalledTimes(1);
    expect(githubSpy).not.toHaveBeenCalled();
  });

  it("list and deny with author_app do not build the provider or merge", async () => {
    const root = makeRoot(APP_BLOCK);
    const listDb = newDb();
    seed(listDb);
    const lister = open({ FRIDAY_HOME: root })(listDb);
    expect((await lister.list("p1")).map((i) => i.id)).toEqual(["00000001"]);
    lister.close?.();
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(withAuthSpy).not.toHaveBeenCalled();
    expect(githubSpy).not.toHaveBeenCalled();

    const denyDb = newDb();
    seed(denyDb);
    const denier = open({ FRIDAY_HOME: root })(denyDb);
    expect(await denier.decide("00000001", "deny")).toEqual({ kind: "denied" });
    denier.close?.();
    expect(merges).toHaveLength(0);
  });

  it("author_token_env keeps using createGitHub and never builds the provider", async () => {
    const dbPath = newDb();
    seed(dbPath);
    const root = makeRoot("  author_token_env: TEST_AUTHOR_TOKEN\n");
    const client = open({ FRIDAY_HOME: root, TEST_AUTHOR_TOKEN: "tok-123" })(dbPath);
    expect(await client.decide("00000001", "approve")).toEqual({ kind: "merged", sha: "m1" });
    client.close?.();
    expect(githubSpy.mock.calls).toEqual([
      ["tok-123", { owner: "alexcanario", repo: "friday-sandbox" }],
    ]);
    expect(tokenSpy).not.toHaveBeenCalled();
    expect(withAuthSpy).not.toHaveBeenCalled();
  });

  it("decide rejects author_app with author_token_env, or neither, before opening the database", async () => {
    for (const block of [APP_BLOCK + ENV_LINE, ""]) {
      const dbPath = newDb();
      const client = open({ FRIDAY_HOME: makeRoot(block), FRIDAY_AUTHOR_TOKEN: "x" })(dbPath);
      await expect(client.decide("00000001", "approve")).rejects.toThrow(
        new Error("O factory.yaml está inválido ou ausente."),
      );
      expect(existsSync(dbPath)).toBe(false);
      expect(tokenSpy).not.toHaveBeenCalled();
      expect(withAuthSpy).not.toHaveBeenCalled();
      expect(githubSpy).not.toHaveBeenCalled();
    }
  });
});
