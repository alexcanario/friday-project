import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDispatchConfig } from "../src/index.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");

describe("readDispatchConfig", () => {
  it("readDispatchConfig maps factory.yaml and rereads it", () => {
    const dir = mkdtempSync(join(tmpdir(), "friday-dispatch-"));
    cpSync(fixture, dir, { recursive: true });
    const file = join(dir, "factory.yaml");
    const original = readFileSync(file, "utf8");
    expect(readDispatchConfig(dir)).toEqual({
      risk: {
        rules: ["migrations", "infra", "ci", "dependencies", "secrets", "agent_config", "size"],
        max_changed_lines: 2000,
        max_changed_files: 50,
      },
      mergeMode: "manual",
      screenPaths: ["**/*.razor"],
    });
    writeFileSync(file, original.replace("merge: manual", "merge: auto"));
    expect(readDispatchConfig(dir)?.mergeMode).toBe("auto");
    writeFileSync(file, "enabled: [");
    expect(readDispatchConfig(dir)).toBeNull();
  });
});
