import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), "utf8");

describe("live wiring", () => {
  it("useLiveEvents depends on token and host and App uses liveTarget", () => {
    expect(read("../src/use-live-events.ts")).toContain(
      "[baseUrl, project, token, host, queryClient, onState]",
    );
    const app = read("../src/App.tsx");
    expect(app).toContain("liveTarget(");
    expect(app).toContain("useLiveEvents(");
  });

  it("App subscribes to the token store and resets the live state", () => {
    const app = read("../src/App.tsx");
    expect(app).toContain("useSyncExternalStore(subscribeToken, tokenVersion, tokenVersion)");
    expect(app).toContain("liveTarget(");
    expect(app).toContain("liveStateFor(");
    expect(app).toContain("useCallback(");
    expect(app).toContain("[key]");
    expect(app).not.toContain("useLiveEvents(target?.baseUrl ?? \"\", target?.project, (");
  });
});
