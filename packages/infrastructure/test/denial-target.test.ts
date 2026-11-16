import { describe, expect, it } from "vitest";
import { denialTargetOf } from "../src/denial-target.ts";

describe("denialTargetOf", () => {
  it("returns the file_path of Read", () => {
    expect(denialTargetOf("Read", { file_path: "/tmp/outside.txt" })).toBe("/tmp/outside.txt");
  });

  it("returns pattern and optional path for Grep and Glob", () => {
    expect(denialTargetOf("Grep", { pattern: "foo", path: "/x" })).toBe("pattern=foo path=/x");
    expect(denialTargetOf("Grep", { pattern: "foo" })).toBe("pattern=foo");
    expect(denialTargetOf("Glob", { pattern: "**/*.ts", path: "/y" })).toBe(
      "pattern=**/*.ts path=/y",
    );
    expect(denialTargetOf("Glob", { pattern: "**/*.ts" })).toBe("pattern=**/*.ts");
  });

  it("returns file_path for Edit and Write and command for Bash", () => {
    expect(denialTargetOf("Edit", { file_path: "/a.ts", old_string: "x" })).toBe("/a.ts");
    expect(denialTargetOf("Write", { file_path: "/b.ts", content: "" })).toBe("/b.ts");
    expect(denialTargetOf("Bash", { command: "rm -rf x" })).toBe("rm -rf x");
  });

  it("returns undefined for mcp tools and malformed input", () => {
    expect(denialTargetOf("mcp__friday__x", { file_path: "/a" })).toBeUndefined();
    for (const bad of [null, undefined, [], ["a"], "text", 3]) {
      expect(denialTargetOf("Read", bad)).toBeUndefined();
    }
    expect(denialTargetOf("Read", {})).toBeUndefined();
    expect(denialTargetOf("Read", { file_path: 5 })).toBeUndefined();
    expect(denialTargetOf("Grep", { path: "/x" })).toBeUndefined();
    expect(denialTargetOf("Glob", { path: "/x" })).toBeUndefined();
    expect(denialTargetOf("Grep", { pattern: 1 })).toBeUndefined();
    expect(denialTargetOf("Edit", {})).toBeUndefined();
    expect(denialTargetOf("Write", {})).toBeUndefined();
    expect(denialTargetOf("Bash", {})).toBeUndefined();
    expect(denialTargetOf("Bash", { command: 1 })).toBeUndefined();
    expect(denialTargetOf("Grep", { pattern: "foo", path: 7 })).toBe("pattern=foo");
    expect(denialTargetOf("Glob", { pattern: "*.ts", path: null })).toBe("pattern=*.ts");
  });
});
