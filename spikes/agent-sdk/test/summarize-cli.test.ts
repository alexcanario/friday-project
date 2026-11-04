import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parseJsonl, summarizeMessages } from "../src/summarize.ts";

const spikeDir = resolve(import.meta.dirname, "..");
const run = (args: string[]) =>
  spawnSync(process.execPath, ["summarize.ts", ...args], { cwd: spikeDir, encoding: "utf8" });

describe("summarize.ts", () => {
  it("prints the summary and exits with the right codes", () => {
    const ok = run(["test/fixtures/ok.jsonl"]);
    expect(ok.status).toBe(0);
    const expected = summarizeMessages(
      parseJsonl(readFileSync(resolve(spikeDir, "test/fixtures/ok.jsonl"), "utf8")),
    );
    expect(JSON.parse(ok.stdout)).toEqual(expected);

    const bad = run(["test/fixtures/no-result.jsonl"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("mensagem result ausente");

    const none = run([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("uso: node summarize.ts <arquivo>");
  });
});
