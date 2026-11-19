import { afterEach, describe, expect, it, vi } from "vitest";
import { readToken, saveToken, submitToken } from "../src/token.ts";

afterEach(() => vi.unstubAllGlobals());

function fakeStorage() {
  const data = new Map<string, string>();
  return {
    getItem: vi.fn((k: string) => data.get(k) ?? null),
    setItem: vi.fn((k: string, v: string) => void data.set(k, v)),
  };
}

describe("panel token", () => {
  it("stores the token per host in sessionStorage only", () => {
    const session = fakeStorage();
    const local = fakeStorage();
    vi.stubGlobal("sessionStorage", session);
    vi.stubGlobal("localStorage", local);
    expect(readToken("h1")).toBe("");
    saveToken("h1", "s3cret");
    expect(session.getItem("friday.panelToken.h1")).toBe("s3cret");
    expect(readToken("h1")).toBe("s3cret");
    expect(readToken("h2")).toBe("");
    expect(submitToken("h1", "x")).toBe(true);
    expect(submitToken("h1", "")).toBe(false);
    expect(local.setItem).not.toHaveBeenCalled();
    vi.stubGlobal("sessionStorage", undefined);
    expect(readToken("h1")).toBe("");
  });
});
