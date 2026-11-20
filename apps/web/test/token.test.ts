import { afterEach, describe, expect, it, vi } from "vitest";
import { readToken, saveToken, submitToken, subscribeToken, tokenVersion } from "../src/token.ts";

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

  it("notifies subscribers once per save and stops after unsubscribe", () => {
    vi.stubGlobal("sessionStorage", fakeStorage());
    const listener = vi.fn();
    const unsubscribe = subscribeToken(listener);
    const before = tokenVersion();
    saveToken("h1", "x");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(tokenVersion()).toBe(before + 1);
    submitToken("h1", "");
    expect(listener).toHaveBeenCalledTimes(2);
    expect(tokenVersion()).toBe(before + 2);
    unsubscribe();
    saveToken("h1", "y");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("does not notify when sessionStorage throws", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => null,
      setItem: () => {
        throw new Error("quota");
      },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeToken(listener);
    const before = tokenVersion();
    expect(() => saveToken("h1", "x")).toThrow("quota");
    expect(listener).not.toHaveBeenCalled();
    expect(tokenVersion()).toBe(before);
    unsubscribe();
  });
});
