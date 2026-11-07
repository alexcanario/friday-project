import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { FakeAgentRuntime } from "@friday/application";
import { createIssueRepository, createLedgerRepository, isInside } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import * as daemon from "../src/index.ts";
import { composeDaemon } from "../src/index.ts";
import { setup } from "./compose-helpers.ts";
import { FICHA, GOOD, finished } from "./triage-fakes.ts";
import { FakeTriageGitHub } from "./triage-fakes.ts";

function triageScenario() {
  const t = setup();
  const github = new FakeTriageGitHub();
  github.issues.push({ number: 7, title: "T", body: "B", labels: ["friday"] });
  const runtime = new FakeAgentRuntime([finished(GOOD, "succeeded", 0.3)]);
  t.opts.createGitHub = (() => github) as unknown as typeof t.opts.createGitHub;
  t.opts.runtime = runtime;
  return { ...t, github, runtime };
}

describe("composeDaemon triage wiring", () => {
  it("triages an ingested issue on tick with the factory.yaml flow", async () => {
    const t = triageScenario();
    const daemonHandle = await composeDaemon({ ...t.opts, triage: FICHA });
    await daemonHandle.ticker.tick();
    await daemonHandle.ticker.idle();
    expect(t.runtime.requests).toHaveLength(1);
    const request = t.runtime.requests[0]!;
    expect(request.agent.model).toBe("haiku");
    expect(request.agent.maxBudgetUsd).toBe(0.5);
    expect(request.agent.tools).toEqual([]);
    expect(request.agent.allowedTools).toEqual([]);
    expect(request.configRoot).toBe(t.root);
    expect(request.cwd).toBe(join(t.root, ".friday", "triage"));
    expect(statSync(request.cwd).isDirectory()).toBe(true);
    expect(isInside(request.cwd, request.configRoot)).toBe(false);
    expect(t.github.labelCalls).toEqual([{ issue: 7, label: "specialist:backend" }]);
    expect(t.github.commentCalls[0]?.text).toBe('Triagem: backend. Motivo: "Endpoint de API"');
    expect(createIssueRepository(daemonHandle.db).get("p", 7)?.state).toBe("InProgress");
    expect(createLedgerRepository(daemonHandle.db).sumByIssue("p", 7)).toEqual({
      costUsd: 0.3,
      anyCostUnknown: false,
    });
    daemonHandle.release();
  });

  it("leaves Todo alone without the option and rejects an invalid ficha before the lock", async () => {
    const t = triageScenario();
    const plain = await composeDaemon(t.opts);
    await plain.ticker.tick();
    await plain.ticker.idle();
    expect(createIssueRepository(plain.db).get("p", 7)?.state).toBe("Todo");
    expect(t.runtime.requests).toHaveLength(0);
    plain.release();

    const u = triageScenario();
    await expect(composeDaemon({ ...u.opts, triage: { ...FICHA, maxTurns: 0 } })).rejects.toThrow(
      "A ficha da triagem é inválida.",
    );
    expect(existsSync(join(u.root, ".friday", "daemon.lock"))).toBe(false);
    expect(existsSync(u.opts.dbPath)).toBe(false);
  });

  it("exports the triage pieces from the package index", () => {
    expect(typeof daemon.buildTriageRequest).toBe("function");
    expect(typeof daemon.runTriageForIssue).toBe("function");
    expect(typeof daemon.createTriageBranch).toBe("function");
  });
});
