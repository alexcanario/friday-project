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

  it("hostsFile refuses a base without protocol", () => {
    const parse = (baseUrl: string) => hostsFile.safeParse([{ name: "a", baseUrl }]).success;
    for (const b of ["//host.remoto", "\\\\host.remoto", " //host.remoto", "http:"]) {
      expect(parse(b)).toBe(false);
    }
    for (const b of ["", "https://h", "http://127.0.0.1:7777", "http://localhost:7777"]) {
      expect(parse(b)).toBe(true);
    }
  });

  it("hostsFile refuses an http(s) base without two slashes", () => {
    const parse = (baseUrl: string) => hostsFile.safeParse([{ name: "a", baseUrl }]).success;
    for (const b of ["http:localhost:7777", "http:/localhost:7777", "https:host"]) {
      expect(parse(b)).toBe(false);
    }
    for (const b of ["https://h", "http://localhost:7777"]) expect(parse(b)).toBe(true);
  });
});
