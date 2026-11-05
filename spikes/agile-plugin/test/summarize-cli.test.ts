import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { summarizeRun } from "../src/summarize.ts";

const spikeDir = resolve(import.meta.dirname, "..");
const run = (args: string[]) =>
  spawnSync(process.execPath, ["summarize.ts", ...args], { cwd: spikeDir, encoding: "utf8" });

describe("summarize.ts", () => {
  it("prints the summary and exits with the right codes", () => {
    const ok = run(["test/fixtures/ask.jsonl", "test/fixtures/can-use-tool.json"]);
    expect(ok.status).toBe(0);
    expect(JSON.parse(ok.stdout)).toEqual(
      summarizeRun(
        resolve(spikeDir, "test/fixtures/ask.jsonl"),
        resolve(spikeDir, "test/fixtures/can-use-tool.json"),
      ),
    );

    const bad = run(["test/fixtures/no-result.jsonl", "test/fixtures/can-use-tool.json"]);
    expect(bad.status).toBe(1);
    expect(bad.stderr).toContain("mensagem result ausente");

    const none = run([]);
    expect(none.status).toBe(2);
    expect(none.stderr).toContain("uso: node summarize.ts <messages> <can-use-tool>");
  });
});
