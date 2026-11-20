import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/query-keys.ts";

describe("query keys", () => {
  it("builds the health, list and detail query keys", () => {
    expect(queryKeys.health).toEqual(["health"]);
    expect(queryKeys.issues("p1")).toEqual(["issues", "p1"]);
    expect(queryKeys.issue("p1", 7)).toEqual(["issues", "p1", 7]);
  });

  it("approvals and status keys end with the host", () => {
    expect(queryKeys.approvals("o/r", "h1")).toEqual(["approvals", "o/r", "h1"]);
    expect(queryKeys.status("o/r", "h1")).toEqual(["status", "o/r", "h1"]);
    expect(queryKeys.approvals("o/r", "h1")).not.toEqual(queryKeys.approvals("o/r", "h2"));
    expect(queryKeys.status("o/r", "h1")).not.toEqual(queryKeys.status("o/r", "h2"));
    const qc = new QueryClient();
    const h1 = queryKeys.approvals("o/r", "h1");
    const h2 = queryKeys.approvals("o/r", "h2");
    qc.setQueryData(h1, []);
    qc.setQueryData(h2, []);
    void qc.invalidateQueries({ queryKey: h1 });
    expect(qc.getQueryState(h1)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(h2)?.isInvalidated).toBe(false);
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

  it("run keys end with the host and sit under the issues prefix", () => {
    expect(queryKeys.projectRun("o/r", "r1", "h1")).toEqual(["issues", "o/r", "run", "r1", "h1"]);
    expect(queryKeys.projectRunReview("o/r", "r1", "h1")).toEqual([
      "issues",
      "o/r",
      "run-review",
      "r1",
      "h1",
    ]);
    const qc = new QueryClient();
    const keys = [
      queryKeys.projectRun("o/r", "r1", "h1"),
      queryKeys.projectRunReview("o/r", "r1", "h1"),
      queryKeys.projectRun("outro/r", "r1", "h1"),
    ];
    for (const key of keys) qc.setQueryData(key, {});
    void qc.invalidateQueries({ queryKey: queryKeys.issues("o/r") });
    expect(qc.getQueryState(keys[0]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[1]!)?.isInvalidated).toBe(true);
    expect(qc.getQueryState(keys[2]!)?.isInvalidated).toBe(false);
  });
});
