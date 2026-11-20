import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/query-keys.ts";

describe("query keys", () => {
  it("builds the health, list and detail query keys", () => {
    expect(queryKeys.health).toEqual(["health"]);
    expect(queryKeys.issues("p1")).toEqual(["issues", "p1"]);
    expect(queryKeys.issue("p1", 7)).toEqual(["issues", "p1", 7]);
  });

  it("builds project list keys under the keys the live stream invalidates", () => {
    expect(queryKeys.projectIssues("o/r", "h1")).toEqual(["issues", "o/r", "list", "h1"]);
    expect(queryKeys.projectRuns("o/r", "h1")).toEqual(["issues", "o/r", "runs", "h1"]);
    const qc = new QueryClient();
    const keys = [
      queryKeys.projectIssues("o/r", "h1"),
      queryKeys.projectRuns("o/r", "h1"),
      queryKeys.projectIssues("outro/r", "h1"),
    ];
    for (const key of keys) qc.setQueryData(key, []);
    void qc.invalidateQueries({ queryKey: queryKeys.issues("o/r") });
    expect(qc.getQueryState(keys[0]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[1]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[2]!)?.isInvalidated).toBe(false);
  });
});
