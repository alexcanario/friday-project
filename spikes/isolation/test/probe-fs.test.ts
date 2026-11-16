import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const probe = resolve(import.meta.dirname, "../src/probe.ts");
const root = mkdtempSync(join(tmpdir(), "friday-probe-"));

afterAll(() => rmSync(root, { recursive: true, force: true }));

type PathInfo = { exists: boolean; readable: boolean; content?: string; entries?: string[] };

describe("probe fs", () => {
  it("fs probe reports entries, content and existence", () => {
    const empty = join(root, "empty");
    const full = join(root, "full");
    const file = join(root, "note.txt");
    const missing = join(root, "missing");
    mkdirSync(empty);
    mkdirSync(full);
    writeFileSync(join(full, "a.txt"), "a");
    writeFileSync(file, "hello");
    const run = spawnSync(process.execPath, [probe, "fs", JSON.stringify([empty, full, file, missing])], { encoding: "utf8" });
    expect(run.status).toBe(0);
    const { paths } = JSON.parse(run.stdout) as { paths: Record<string, PathInfo> };
    expect(paths[empty]?.exists).toBe(true);
    expect(paths[empty]?.entries).toEqual([]);
    expect(paths[full]?.entries).toEqual(["a.txt"]);
    expect(paths[file]).toMatchObject({ exists: true, readable: true, content: "hello" });
    expect(paths[file]?.entries).toBeUndefined();
    expect(paths[missing]?.exists).toBe(false);
    expect(paths[missing]?.entries).toBeUndefined();
  });
});
