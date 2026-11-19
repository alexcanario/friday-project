import { describe, expect, it } from "vitest";
import { hostsFile } from "../src/index.ts";

describe("hosts file", () => {
  it("accepts a valid host list and rejects missing name, bad URL, duplicate name and a token field", () => {
    const ok = [
      { name: "local", baseUrl: "" },
      { name: "vps1", baseUrl: "https://vps1.example:7777" },
    ];
    expect(hostsFile.safeParse(ok).success).toBe(true);
    expect(hostsFile.safeParse([]).success).toBe(true);
    const bad: unknown[] = [
      [{ baseUrl: "" }],
      [{ name: "", baseUrl: "" }],
      [{ name: "a", baseUrl: "nao-e-url" }],
      [{ name: "a", baseUrl: "ftp://h" }],
      [
        { name: "a", baseUrl: "" },
        { name: "a", baseUrl: "https://h.example" },
      ],
      [{ name: "a", baseUrl: "", token: "x" }],
    ];
    for (const input of bad) expect(hostsFile.safeParse(input).success).toBe(false);
  });
});
