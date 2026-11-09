import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");

describe("denial sources", () => {
  it("sources no longer mention canUseTool", () => {
    expect(read("denial-dedup.ts")).not.toContain("canUseTool");
    const query = read("query-options.ts");
    expect(query).not.toContain("canUseTool");
    expect(query).not.toContain("denialMessage");
  });
});
