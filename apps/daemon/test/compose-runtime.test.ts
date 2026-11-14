import { existsSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { setupCompose } from "./compose-runtime-helpers.ts";

const isInside = (child: string, parent: string) => {
  const rel = relative(parent, child);
  return rel !== "" && rel !== ".." && !rel.startsWith(".." + sep) && !isAbsolute(rel);
};

describe("composeDaemon runtime wiring", () => {
  it("composes the GitCliHost once with token variable name, mirror and target URL", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(t.opts);
    expect(t.createGitHost).toHaveBeenCalledTimes(1);
    const options = t.createGitHost.mock.calls[0]![0];
    expect(options).toEqual(
      expect.objectContaining({
        tokenEnv: "FRIDAY_AUTHOR_TOKEN",
        repoDir: t.opts.repoDir,
        mirrorDir: join(t.home, "mirrors", "alexcanario__friday-sandbox.git"),
        targetUrl: "https://github.com/alexcanario/friday-sandbox.git",
      }),
    );
    expect(options.env).toBe(t.opts.env);
    expect(isInside(options.mirrorDir, t.root)).toBe(false);
    daemon.release();
  });

  it("rejects an invalid git host configuration without lock or database", async () => {
    const bad = setupCompose({
      tokenEnv: "PATH",
      env: { PATH: "/usr/bin" },
      withGitHostSpy: false,
    });
    await expect(composeDaemon(bad.opts)).rejects.toThrow(
      "O nome da variável de ambiente do token não pode ser uma variável da lista de permissão do ambiente do git.",
    );
    expect(existsSync(join(bad.root, ".friday", "daemon.lock"))).toBe(false);
    expect(existsSync(bad.opts.dbPath)).toBe(false);
    const rel = setupCompose({
      env: { FRIDAY_AUTHOR_TOKEN: "t", FRIDAY_HOME: "relativo" },
    });
    await expect(composeDaemon(rel.opts)).rejects.toThrow(
      "A variável FRIDAY_HOME deve ser um caminho absoluto.",
    );
    expect(existsSync(join(rel.root, ".friday", "daemon.lock"))).toBe(false);
    expect(existsSync(rel.opts.dbPath)).toBe(false);
  });

  it("creates the runtime per run with github, gitHost and env", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    await Promise.resolve();
    expect(t.createRuntime).toHaveBeenCalledTimes(1);
    const { deps, run } = t.runs[0]!;
    expect(deps.github).toBe((t.opts.createGitHub as unknown as () => unknown).call(undefined));
    expect(deps.gitHost).toBe(t.gitHost);
    expect(deps.env).toEqual(t.opts.env);
    expect(deps.runs).toBeDefined();
    expect(deps.results).toBeDefined();
    const row = daemon.db.sqlite.prepare("SELECT id FROM runs").get() as { id: string };
    expect(deps.results!.has(row.id, "qaReport")).toBe(false);
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    expect(run).toHaveBeenCalledTimes(1);
    expect(t.optsRun).not.toHaveBeenCalled();
    daemon.release();
  });

  it("binds the run lookup to the database", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    await Promise.resolve();
    const { deps } = t.runs[0]!;
    const row = daemon.db.sqlite.prepare("SELECT id FROM runs").get() as { id: string };
    expect(deps.runs!.isActive(row.id)).toBe(true);
    expect(deps.runs!.isActive("outra-run")).toBe(false);
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    expect(deps.runs!.isActive(row.id)).toBe(false);
    daemon.release();
  });

  it("records denials as ToolDenied events of their own run", async () => {
    const t = setupCompose();
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    await Promise.resolve();
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    t.github.issues.splice(0, 1, { number: 8, title: "Issue", labels: ["friday"] } as never);
    await daemon.ticker.tick();
    await Promise.resolve();
    t.gates.forEach((g) => g());
    await daemon.ticker.idle();
    expect(t.createRuntime).toHaveBeenCalledTimes(2);
    const [first, second] = t.runs.map((r) => r.deps.sink!);
    expect(first).not.toBe(second);
    first!.record({ toolName: "Bash", toolUseId: "u1" });
    first!.record({ toolName: "Bash", toolUseId: "u1" });
    const rows = daemon.db.sqlite
      .prepare("SELECT run_id, issue_id FROM events WHERE type = 'ToolDenied'")
      .all() as { run_id: string; issue_id: number }[];
    const firstRun = daemon.db.sqlite.prepare("SELECT id FROM runs WHERE issue_id = 7").get() as {
      id: string;
    };
    expect(rows).toEqual([{ run_id: firstRun.id, issue_id: 7 }]);
    daemon.release();
  });

  it("fails the run when createRuntime throws", async () => {
    const t = setupCompose({ createRuntimeThrows: true });
    const daemon = await composeDaemon(t.opts);
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    const row = daemon.db.sqlite.prepare("SELECT status FROM runs").get() as { status: string };
    expect(row.status).toBe("failed");
    const dispatched = daemon.db.sqlite
      .prepare("SELECT COUNT(*) AS n FROM events WHERE type = 'RunDispatched'")
      .get() as { n: number };
    expect(dispatched.n).toBe(0);
    daemon.release();
  });
});
