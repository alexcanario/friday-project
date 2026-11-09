import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createEventStore, createIssueRepository } from "@friday/infrastructure";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { NOW, setup } from "./compose-helpers.ts";

describe("composeDaemon log redaction", () => {
  it("redacts list failures logged by composeDaemon by default", async () => {
    const t = setup();
    vi.spyOn(t.github, "listIssuesByLabel").mockRejectedValue(new Error("Bearer t0k3n"));
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    daemon.release();
    expect(t.logs).toContain("Failed to list issues: Bearer ***");
    expect(t.logs).toContain("Falha ao listar as issues: Bearer ***");
    expect(t.logs.some((l) => l.includes("t0k3n"))).toBe(false);
  });

  it("redacts dispatch failures logged by composeDaemon", async () => {
    const t = setup();
    t.github.issues.push({ number: 13, title: "T", body: "", labels: ["friday"] });
    vi.spyOn(t.github, "getPrDiff").mockRejectedValue(new Error("Bearer t0k3n"));
    const daemon = await composeDaemon({ ...t.opts, prOf: () => 5 });
    const at = NOW.toISOString();
    const events = createEventStore(daemon.db);
    events.append({
      projectId: "p",
      issueId: 13,
      runId: null,
      type: "IssueIngested",
      actor: "daemon",
      at,
      payload: { type: "IssueIngested", issueId: "13", title: "T" },
    });
    events.append({
      projectId: "p",
      issueId: 13,
      runId: null,
      type: "StateChanged",
      actor: "daemon",
      at,
      payload: {
        type: "StateChanged",
        issueId: "13",
        from: "Review",
        to: "RiskCheck",
        trigger: "JudgeApproved",
        heldReason: null,
        verifyRound: 0,
        qaRound: 0,
        reviewIter: 0,
      },
    });
    createIssueRepository(daemon.db).rebuild("p");
    await daemon.ticker.tick();
    daemon.release();
    expect(t.logs).toContain("Falha ao despachar a issue 13: Bearer ***");
    expect(t.logs.some((l) => l.includes("t0k3n"))).toBe(false);
  });

  it("applies the redactor at a single point in src", () => {
    const dir = join(import.meta.dirname, "../src");
    const files = readdirSync(dir).filter(
      (f) => f.endsWith(".ts") && f !== "redact.ts" && f !== "index.ts",
    );
    const users = files.filter((f) =>
      /createRedactor|withRedactedLog/.test(readFileSync(join(dir, f), "utf8")),
    );
    expect(users.length).toBeLessThanOrEqual(1);
    const calls = files
      .map((f) => readFileSync(join(dir, f), "utf8").split("withRedactedLog(").length - 1)
      .reduce((a, b) => a + b, 0);
    expect(calls).toBeLessThanOrEqual(1);
  });
});
