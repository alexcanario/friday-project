import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runApprovals, type ApprovalsClient, type DecisionResult } from "../src/approvals.ts";
import { root } from "./helpers.ts";

const A = "a".repeat(40);
const T0 = 1_000_000;
const pending = {
  id: "00000001",
  issueId: 7,
  pr: 30,
  headSha: A,
  tier: "high",
  requestedAt: T0,
  expiresAt: T0 + 1_800_000,
};

function fake(opts: {
  list?: (typeof pending)[] | Error;
  decide?: DecisionResult | Error;
  withClose?: boolean;
}) {
  const calls = { list: [] as string[], decide: [] as unknown[][], close: 0, open: [] as string[] };
  const client: ApprovalsClient = {
    list: async (project) => {
      calls.list.push(project);
      if (opts.list instanceof Error) throw opts.list;
      return opts.list ?? [];
    },
    decide: async (...args: unknown[]) => {
      calls.decide.push(args);
      if (opts.decide instanceof Error) throw opts.decide;
      return opts.decide ?? { kind: "denied" };
    },
    ...(opts.withClose === false
      ? {}
      : {
          close: () => {
            calls.close += 1;
          },
        }),
  };
  const open = (db: string) => {
    calls.open.push(db);
    return client;
  };
  return { calls, open };
}

describe("friday approvals", () => {
  it("lists the pending approvals one per line and says when there are none", async () => {
    const f = fake({ list: [pending] });
    const out = await runApprovals(
      ["approvals", "list", "--db", "x.db", "--project", "p1"],
      f.open,
    );
    expect(out).toEqual({
      stdout: `00000001\tPR #30\tissue #7\thigh\texpira ${new Date(T0 + 1_800_000).toISOString()}\n`,
      stderr: "",
      code: 0,
    });
    expect(out.stdout).toBe("00000001\tPR #30\tissue #7\thigh\texpira 1970-01-01T00:46:40.000Z\n");
    expect(f.calls.list).toEqual(["p1"]);
    expect(f.calls.open).toEqual(["x.db"]);
    const e = fake({ list: [] });
    expect(
      await runApprovals(["approvals", "list", "--db", "x.db", "--project", "p1"], e.open),
    ).toEqual({ stdout: "Nenhuma aprovação pendente.\n", stderr: "", code: 0 });
  });

  it("approves and prints the merged sha", async () => {
    const f = fake({ decide: { kind: "merged", sha: "m1" } });
    expect(await runApprovals(["approvals", "approve", "00000001", "--db", "x.db"], f.open)).toEqual(
      { stdout: "Aprovação 00000001 mesclada: m1\n", stderr: "", code: 0 },
    );
    expect(f.calls.decide).toEqual([["00000001", "approve"]]);
    expect(f.calls.open).toEqual(["x.db"]);
  });

  it("denies and prints the denial", async () => {
    const f = fake({ decide: { kind: "denied" } });
    expect(await runApprovals(["approvals", "deny", "00000001", "--db", "x.db"], f.open)).toEqual({
      stdout: "Aprovação 00000001 negada.\n",
      stderr: "",
      code: 0,
    });
    expect(f.calls.decide).toEqual([["00000001", "deny"]]);
  });

  it("exits 1 with a pt-BR message for each refusal and failure", async () => {
    const cases: [DecisionResult | Error, string][] = [
      [{ kind: "unknown" }, "Aprovação não encontrada.\n"],
      [{ kind: "already_decided" }, "Aprovação já decidida.\n"],
      [{ kind: "expired" }, "Aprovação expirada.\n"],
      [{ kind: "head_changed" }, "O PR mudou depois do pedido de aprovação.\n"],
      [{ kind: "merge_blocked" }, "Merge recusado pelo GitHub.\n"],
      [new Error("falha 502"), "Falha ao decidir a aprovação.\n"],
    ];
    for (const [decide, stderr] of cases) {
      const f = fake({ decide });
      const out = await runApprovals(["approvals", "approve", "1", "--db", "x.db"], f.open);
      expect(out).toEqual({ stdout: "", stderr, code: 1 });
      expect(out.stderr).not.toContain("falha 502");
    }
    const f = fake({ list: new Error("falha 502") });
    expect(
      await runApprovals(["approvals", "list", "--db", "x.db", "--project", "p1"], f.open),
    ).toEqual({ stdout: "", stderr: "Falha ao listar as aprovações.\n", code: 1 });
  });

  it("exits 2 with usage for invalid arguments without opening the client", async () => {
    const bad = [
      ["approvals"],
      ["approvals", "list", "--db", "x.db"],
      ["approvals", "list", "--db", "x.db", "--project", ""],
      ["approvals", "list", "--project", "p1"],
      ["approvals", "approve", "1"],
      ["approvals", "approve", "1", "--db", ""],
      ["approvals", "approve", "--db", "x.db"],
      ["approvals", "deny", "", "--db", "x.db"],
      ["approvals", "approve", "1", "2", "--db", "x.db"],
      ["approvals", "frobnicate", "1", "--db", "x.db"],
      ["approvals", "approve", "1", "--db", "x.db", "--actor", "x"],
    ];
    for (const args of bad) {
      const f = fake({});
      const out = await runApprovals(args, f.open);
      expect(out.code, args.join(" ")).toBe(2);
      expect(out.stdout).toBe("");
      expect(out.stderr.startsWith("Uso: friday approvals")).toBe(true);
      expect(f.calls.open).toEqual([]);
      expect(f.calls.close).toBe(0);
    }
  });

  it("closes the client once and tolerates a client without close", async () => {
    const runs: [string[], Parameters<typeof fake>[0]][] = [
      [["approvals", "list", "--db", "x.db", "--project", "p1"], { list: [pending] }],
      [["approvals", "approve", "1", "--db", "x.db"], { decide: { kind: "merged", sha: "m1" } }],
      [["approvals", "approve", "1", "--db", "x.db"], { decide: new Error("x") }],
      [["approvals", "list", "--db", "x.db", "--project", "p1"], { list: new Error("x") }],
    ];
    for (const [args, opts] of runs) {
      const f = fake(opts);
      await runApprovals(args, f.open);
      expect(f.calls.close).toBe(1);
      const g = fake({ ...opts, withClose: false });
      await expect(runApprovals(args, g.open)).resolves.toBeDefined();
    }
  });

  it("routes approvals in index.ts and keeps config check", () => {
    const run = (...args: string[]) => {
      const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
        cwd: root,
        encoding: "utf8",
      });
      return { stdout: r.stdout, stderr: r.stderr, code: r.status };
    };
    const none = run("approvals");
    expect(none.code).toBe(2);
    expect(none.stderr.startsWith("Uso: friday approvals")).toBe(true);
    const db = join(mkdtempSync(join(tmpdir(), "friday-appr-")), "absent.db");
    expect(run("approvals", "list", "--db", db, "--project", "p1")).toEqual({
      stdout: "",
      stderr: "Falha ao listar as aprovações.\n",
      code: 1,
    });
    expect(run("approvals", "approve", "00000001", "--db", db)).toEqual({
      stdout: "",
      stderr: "Falha ao decidir a aprovação.\n",
      code: 1,
    });
    expect(existsSync(db)).toBe(false);
    const fixture = join(root, "packages/infrastructure/test/fixtures/valid");
    expect(run("config", "check", "--root", fixture)).toEqual({
      stdout: "0 problemas\n",
      stderr: "",
      code: 0,
    });
  });
});
