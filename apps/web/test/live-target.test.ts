import { afterEach, describe, expect, it, vi } from "vitest";
import { liveTarget } from "../src/live-target.ts";
import { saveToken } from "../src/token.ts";

afterEach(() => vi.unstubAllGlobals());

function stubSession(entries: Record<string, string>): void {
  vi.stubGlobal("sessionStorage", {
    getItem: (key: string) => entries[key] ?? null,
    setItem: () => undefined,
  });
}

describe("live target", () => {
  it("liveTarget maps the selected host, project and its own token and is null otherwise", () => {
    stubSession({ "friday.panelToken.h1": "tok", "friday.panelToken.h2": "outro" });
    const h1 = { name: "h1", baseUrl: "https://h1.example" };
    const h2 = { name: "h2", baseUrl: "https://h2.example" };
    expect(liveTarget({ kind: "selected", host: h1, project: "o/r" })).toEqual({
      baseUrl: "https://h1.example",
      project: "o/r",
      host: "h1",
      token: "tok",
    });
    expect(liveTarget({ kind: "selected", host: h2, project: "o/r" })).toEqual({
      baseUrl: "https://h2.example",
      project: "o/r",
      host: "h2",
      token: "outro",
    });
    expect(liveTarget({ kind: "selected", host: h1, project: "o/r", run: "r1" })).not.toBeNull();
    expect(liveTarget({ kind: "none" })).toBeNull();
    expect(liveTarget({ kind: "unknown-host", host: "zzz" })).toBeNull();
    stubSession({});
    expect(liveTarget({ kind: "selected", host: h1, project: "o/r" })?.token).toBe("");
  });

  it("reads the token saved after the first call and ignores other hosts", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
    });
    const h1 = { name: "h1", baseUrl: "https://h1.example" };
    const selection = { kind: "selected", host: h1, project: "o/r" } as const;
    expect(liveTarget(selection)?.token).toBe("");
    saveToken("h1", "tok");
    const after = liveTarget(selection);
    expect(after?.token).toBe("tok");
    saveToken("h2", "outro");
    expect(liveTarget(selection)).toEqual(after);
  });
});
