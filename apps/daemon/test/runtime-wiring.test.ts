import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentRunRequest, GitHost, GitHubPort } from "@friday/application";
import { GitCliHost, openDatabase } from "@friday/infrastructure";
import { describe, expect, it } from "vitest";
import { buildRuntimeFor, mirrorDirOf, targetUrlOf } from "../src/runtime-wiring.ts";
import { fakeRequest } from "./fakes.ts";

const repository = { owner: "alexcanario", name: "friday-sandbox" };

describe("runtime wiring", () => {
  it("uses FRIDAY_HOME for the mirror directory", () => {
    expect(
      mirrorDirOf({ env: { FRIDAY_HOME: "/srv/friday" }, homeDir: "/home/u", repository }),
    ).toBe("/srv/friday/mirrors/alexcanario__friday-sandbox.git");
  });

  it("falls back to ~/.friday when FRIDAY_HOME is missing or blank", () => {
    const expected = "/home/u/.friday/mirrors/alexcanario__friday-sandbox.git";
    for (const env of [{}, { FRIDAY_HOME: "" }, { FRIDAY_HOME: "   " }]) {
      expect(mirrorDirOf({ env, homeDir: "/home/u", repository })).toBe(expected);
    }
  });

  it("rejects a relative FRIDAY_HOME or home directory", () => {
    expect(() =>
      mirrorDirOf({ env: { FRIDAY_HOME: "relativo/dir" }, homeDir: "/home/u", repository }),
    ).toThrow(new Error("A variável FRIDAY_HOME deve ser um caminho absoluto."));
    expect(() => mirrorDirOf({ env: {}, homeDir: "home/u", repository })).toThrow(
      new Error("O diretório do espelho deve ser um caminho absoluto."),
    );
  });

  it("builds an https target URL accepted by GitCliHost", () => {
    const targetUrl = targetUrlOf(repository);
    expect(targetUrl).toBe("https://github.com/alexcanario/friday-sandbox.git");
    expect(
      () => new GitCliHost({ tokenEnv: "FRIDAY_AUTHOR_TOKEN", mirrorDir: "/tmp/m.git", targetUrl }),
    ).not.toThrow();
  });

  it("the wired runtime refuses a config root equal to or inside the cwd", async () => {
    const base = mkdtempSync(join(tmpdir(), "friday-wire-"));
    const cwd = join(base, "wt");
    mkdirSync(join(cwd, "cfg"), { recursive: true });
    writeFileSync(join(cwd, "p.md"), "x");
    writeFileSync(join(cwd, "cfg", "p.md"), "x");
    mkdirSync(join(base, "sibling"));
    const db = openDatabase(join(base, "f.db"));
    const runtimeFor = buildRuntimeFor({
      db,
      github: {} as GitHubPort,
      gitHost: {} as GitHost,
      env: {},
    });
    const runtime = runtimeFor({ runId: "r", issueId: 1 }, { record: () => undefined });
    const template = fakeRequest(1);
    const agent = { ...template.agent, states: ["InProgress"], promptFile: "p.md" };
    for (const configRoot of [cwd, join(cwd, "cfg"), join(base, "sibling")]) {
      const request = { ...template, agent, cwd, configRoot } as unknown as AgentRunRequest;
      const out = await runtime.run(request);
      expect(out.status).toBe("misconfigured");
    }
    db.close();
  });

  it("returns a new runtime instance per call", () => {
    const db = openDatabase(":memory:");
    const runtimeFor = buildRuntimeFor({
      db,
      github: {} as GitHubPort,
      gitHost: {} as GitHost,
      env: {},
    });
    const ctx = { runId: "r", issueId: 1 };
    const sink = { record: () => undefined };
    expect(runtimeFor(ctx, sink)).not.toBe(runtimeFor(ctx, sink));
    db.close();
  });

  it("keeps the wiring files under 300 lines", () => {
    for (const file of ["compose.ts", "runtime-wiring.ts"]) {
      const text = readFileSync(join(import.meta.dirname, "../src", file), "utf8");
      expect(text.split("\n").length).toBeLessThanOrEqual(300);
    }
  });
});
