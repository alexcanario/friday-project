import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort, WorktreeManager } from "@friday/application";
import { createRunRepository, openDatabase } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { AlreadyRunningError, composeDaemon, type ComposeOptions } from "../src/index.ts";
import { FakeClock, FakeGitHub, PendingRuntime } from "./fakes.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const NOW = new Date("2026-11-05T03:00:00.000Z");
const ok = <T>(value: T) => Promise.resolve({ ok: true as const, value });

function fakeWorktrees(): WorktreeManager {
  return {
    create: vi.fn(),
    remove: vi.fn(() => ok(undefined)),
    list: vi.fn(() => ok([])),
    listOrphans: vi.fn(() => ok([])),
    isClean: vi.fn(() => Promise.resolve(true)),
  } as unknown as WorktreeManager;
}

function setup(edit: (yaml: string) => string = (y) => y) {
  const root = mkdtempSync(join(tmpdir(), "friday-compose-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    "  merge: manual\n",
    "  merge: manual\n  author_token_env: FRIDAY_AUTHOR_TOKEN\n",
  );
  writeFileSync(file, edit(yaml));
  const github = new FakeGitHub();
  const logs: string[] = [];
  const createGitHub = vi.fn((_token: string, _repo: { owner: string; repo: string }) => github);
  const opts: ComposeOptions = {
    root,
    dbPath: join(root, "friday.db"),
    projectId: "p",
    env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" },
    worktrees: fakeWorktrees(),
    runtime: new PendingRuntime(),
    prOf: () => null,
    clock: new FakeClock(),
    lock: { pid: 101, kill: () => undefined },
    now: () => NOW,
    log: (m) => logs.push(m),
    createGitHub: createGitHub as unknown as (
      token: string,
      repo: { owner: string; repo: string },
    ) => GitHubPort,
  };
  return { root, opts, github, logs, createGitHub };
}

const lockFile = (root: string) => join(root, ".friday", "daemon.lock");

describe("composeDaemon", () => {
  it("rejects without author_token_env and leaves no lock or database", async () => {
    const t = setup((y) => y.replace("  author_token_env: FRIDAY_AUTHOR_TOKEN\n", ""));
    await expect(composeDaemon(t.opts)).rejects.toThrow(
      new Error("A configuração não define pull_requests.author_token_env."),
    );
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(lockFile(t.root))).toBe(false);
  });

  it("rejects when the token variable is empty or blank and passes the token to createGitHub otherwise", async () => {
    const t = setup();
    const message = "A variável FRIDAY_AUTHOR_TOKEN está vazia ou ausente.";
    await expect(composeDaemon({ ...t.opts, env: {} })).rejects.toThrow(new Error(message));
    await expect(composeDaemon({ ...t.opts, env: { FRIDAY_AUTHOR_TOKEN: "" } })).rejects.toThrow(
      new Error(message),
    );
    await expect(composeDaemon({ ...t.opts, env: { FRIDAY_AUTHOR_TOKEN: "  " } })).rejects.toThrow(
      new Error(message),
    );
    expect(t.createGitHub).not.toHaveBeenCalled();
    expect(existsSync(lockFile(t.root))).toBe(false);
    const daemon = await composeDaemon(t.opts);
    expect(t.createGitHub).toHaveBeenCalledTimes(1);
    expect(t.createGitHub).toHaveBeenCalledWith("t0k3n", {
      owner: "alexcanario",
      repo: "friday-sandbox",
    });
    await daemon.ticker.tick();
    expect(t.logs.some((m) => m.includes("t0k3n"))).toBe(false);
    daemon.release();
  });

  it("rejects when factory.yaml is invalid or missing", async () => {
    const message = "O factory.yaml está inválido ou ausente.";
    const invalid = setup((y) => y.replace("enabled: true", 'enabled: "sim"'));
    await expect(composeDaemon(invalid.opts)).rejects.toThrow(new Error(message));
    const missing = mkdtempSync(join(tmpdir(), "friday-compose-"));
    const { opts } = setup();
    await expect(composeDaemon({ ...opts, root: missing })).rejects.toThrow(new Error(message));
    expect(existsSync(lockFile(missing))).toBe(false);
  });

  it("inserts the projects row once", async () => {
    const t = setup();
    const rows = (d: Awaited<ReturnType<typeof composeDaemon>>) =>
      d.db.sqlite.prepare("SELECT id FROM projects").all();
    const first = await composeDaemon(t.opts);
    expect(rows(first)).toEqual([{ id: "p" }]);
    first.release();
    const second = await composeDaemon(t.opts);
    expect(rows(second)).toEqual([{ id: "p" }]);
    second.release();
  });

  it("holds the process lock and releases it on failure", async () => {
    const t = setup();
    const first = await composeDaemon(t.opts);
    const other = {
      ...t.opts,
      dbPath: join(t.root, "other.db"),
      lock: { pid: 102, kill: () => undefined },
    };
    await expect(composeDaemon(other)).rejects.toBeInstanceOf(AlreadyRunningError);
    first.release();
    const second = await composeDaemon(other);
    second.release();

    const failing = fakeWorktrees();
    (failing.listOrphans as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("boom"));
    const dbPath = join(t.root, "failing.db");
    await expect(composeDaemon({ ...t.opts, dbPath, worktrees: failing })).rejects.toThrow("boom");
    expect(existsSync(lockFile(t.root))).toBe(false);
    expect(() => openDatabase(dbPath).close()).not.toThrow();
  });

  it("reconciles orphan runs before the first tick", async () => {
    const t = setup();
    const db = openDatabase(t.opts.dbPath);
    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
    createRunRepository(db).save({
      id: "run-1",
      projectId: "p",
      issueId: 7,
      phase: null,
      startedAt: NOW.toISOString(),
      finishedAt: null,
      status: "running",
    });
    db.close();
    const tickSpy = vi.spyOn(FakeClock.prototype, "every");
    const daemon = await composeDaemon(t.opts);
    expect(tickSpy).not.toHaveBeenCalled();
    expect(createRunRepository(daemon.db).get("run-1")?.status).toBe(
      "canceled_by_reconciliation",
    );
    expect(daemon.report.canceledRuns).toEqual(["run-1"]);
    daemon.release();
    tickSpy.mockRestore();
  });

  it("ingests labeled issues on each tick without duplicating", async () => {
    const t = setup();
    t.github.issues.push({ number: 7, title: "T", body: "", labels: ["friday"] });
    const daemon = await composeDaemon(t.opts);
    const count = () =>
      daemon.db.sqlite
        .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'IssueIngested' AND issue_id = 7")
        .get() as { n: number };
    await daemon.ticker.tick();
    const issue = daemon.db.sqlite.prepare("SELECT state FROM issues WHERE issue_id = 7").get();
    expect(issue).toEqual({ state: "Todo" });
    expect(count().n).toBe(1);
    await daemon.ticker.tick();
    expect(count().n).toBe(1);
    daemon.release();
  });

  it("keeps ticking and logs when ingest rejects, and skips ingest when disabled", async () => {
    const t = setup();
    vi.spyOn(t.github, "listIssuesByLabel").mockRejectedValue(new Error("falha"));
    const daemon = await composeDaemon(t.opts);
    await expect(daemon.ticker.tick()).resolves.toBeUndefined();
    expect(t.logs).toContain("Failed to list issues: falha");
    expect(t.logs).toContain("Falha ao listar as issues: falha");
    daemon.release();

    const off = setup((y) => y.replace("enabled: true", "enabled: false"));
    const spy = vi.spyOn(off.github, "listIssuesByLabel");
    const stopped = await composeDaemon(off.opts);
    await stopped.ticker.tick();
    expect(spy).not.toHaveBeenCalled();
    stopped.release();
  });

  it("uses the injected env, not process.env", async () => {
    const t = setup();
    vi.stubEnv("FRIDAY_AUTHOR_TOKEN", "do-ambiente");
    try {
      const daemon = await composeDaemon(t.opts);
      expect(t.createGitHub.mock.calls[0]?.[0]).toBe("t0k3n");
      daemon.release();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
