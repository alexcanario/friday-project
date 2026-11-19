import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { hostsFile } from "@friday/contracts";

describe("shipped hosts.json", () => {
  it("the shipped hosts.json is valid, has no token and no fixed origin", () => {
    const text = readFileSync(join(import.meta.dirname, "../public/hosts.json"), "utf8");
    const parsed: unknown = JSON.parse(text);
    expect(hostsFile.safeParse(parsed).success).toBe(true);
    for (const entry of parsed as Array<Record<string, unknown>>) {
      expect(Object.keys(entry)).not.toContain("token");
    }
    expect(text).not.toContain("127.0.0.1");
    expect(text).not.toContain("localhost");
  });
});
