import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ApprovalRecord } from "@friday/application";
import { openDatabase } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { createApprovalDeps } from "../src/index.ts";
import { ApprovalFakeGitHub } from "./approval-fakes.ts";

const A = "a".repeat(40);

function open() {
  return openDatabase(join(mkdtempSync(join(tmpdir(), "friday-approval-")), "friday.db"));
}

describe("createApprovalDeps", () => {
  it("headOf and prMergeStateOf read getPrMergeState and propagate its failure", async () => {
    const db = open();
    const github = new ApprovalFakeGitHub();
    const deps = createApprovalDeps({ db, github });
    expect(await deps.headOf(5)).toBe(A);
    expect(await deps.prMergeStateOf(5)).toEqual({ merged: false, headSha: A });
    expect(github.mergeStateCalls).toEqual([5, 5]);
    github.mergeStateFailure = new Error("sem rede");
    await expect(deps.headOf(5)).rejects.toThrow("sem rede");
    await expect(deps.prMergeStateOf(5)).rejects.toThrow("sem rede");
    db.close();
  });

  it("newId defaults to 8 lowercase hex and store and unitOfWork use the given database", () => {
    const db = open();
    const github = new ApprovalFakeGitHub();
    const deps = createApprovalDeps({ db, github });
    const first = deps.newId();
    expect(first).toMatch(/^[0-9a-f]{8}$/);
    expect(deps.newId()).not.toBe(first);
    expect(createApprovalDeps({ db, github, newId: () => "0a1b2c3d" }).newId()).toBe("0a1b2c3d");

    db.sqlite.prepare("INSERT INTO projects (id) VALUES ('p')").run();
    const record: ApprovalRecord = {
      id: first,
      projectId: "p",
      issueId: 13,
      pr: 5,
      headSha: A,
      tier: "high",
      requestedAt: 1,
      expiresAt: 2,
      decision: null,
      decidedAt: null,
      decidedBy: null,
    };
    deps.unitOfWork.run(() => deps.store.insert(record));
    expect(db.sqlite.prepare("SELECT id FROM approvals").all()).toEqual([{ id: first }]);
    db.sqlite.prepare("DELETE FROM approvals").run();
    expect(() =>
      deps.unitOfWork.run(() => {
        deps.store.insert(record);
        throw new Error("falha");
      }),
    ).toThrow("falha");
    expect(db.sqlite.prepare("SELECT id FROM approvals").all()).toEqual([]);
    db.close();
  });
});
