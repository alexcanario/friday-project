import { spawnSync } from "node:child_process";
import { nightDigestSchema, type NightReader } from "@friday/application";
import { describe, expect, it } from "vitest";
import { nightDigest } from "../src/night-digest.ts";
import { root } from "./helpers.ts";

const USAGE = "Uso: friday night digest --report-issue <n>\n";

const fake: NightReader = {
  listComments: async () => [{ body: "## Noite de 07/11", createdAt: "2026-11-08T00:00:00Z" }],
  listOpenIssues: async () => [],
  listClosedPulls: async () => [],
  listOpenPulls: async () => [],
};

function spawn(...args: string[]) {
  const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", ...args], {
    cwd: root,
    encoding: "utf8",
  });
  return { stdout: r.stdout, stderr: r.stderr, code: r.status };
}

describe("friday night digest", () => {
  it("prints one valid JSON line and reports read failures with exit 1", async () => {
    const ok = await nightDigest(["night", "digest", "--report-issue", "1"], { reader: fake });
    expect(ok.code).toBe(0);
    expect(ok.stderr).toBe("");
    expect(ok.stdout.endsWith("\n")).toBe(true);
    expect(ok.stdout.trimEnd().split("\n")).toHaveLength(1);
    expect(() => nightDigestSchema.parse(JSON.parse(ok.stdout))).not.toThrow();

    const failing: NightReader = {
      ...fake,
      listComments: async () => Promise.reject(new Error("boom")),
    };
    expect(
      await nightDigest(["night", "digest", "--report-issue", "1"], { reader: failing }),
    ).toEqual({ stdout: "", stderr: "Falha ao ler o GitHub: boom\n", code: 1 });
  });

  it("rejects a digest whose since is not ISO 8601 with exit 1", async () => {
    const bad: NightReader = {
      ...fake,
      listComments: async () => [
        { body: "## Noite de 07/11", createdAt: "2026-11-07T10:00:00Z; rm -rf /" },
      ],
    };
    expect(await nightDigest(["night", "digest", "--report-issue", "1"], { reader: bad })).toEqual({
      stdout: "",
      stderr: "Digest inválido: since\n",
      code: 1,
    });
  });

  it("exits 2 with usage on bad arguments (spawned process)", { timeout: 30_000 }, () => {
    const bad = [
      ["night", "digest"],
      ["night", "digest", "--report-issue", "abc"],
      ["night", "digest", "--report-issue", "0"],
      ["night", "digest", "--report-issue", "1.5"],
      ["night", "digest", "--report-issue", "1", "--x"],
      ["night", "foo"],
    ];
    for (const args of bad) {
      expect(spawn(...args), args.join(" ")).toEqual({ stdout: "", stderr: USAGE, code: 2 });
    }
  });
});
