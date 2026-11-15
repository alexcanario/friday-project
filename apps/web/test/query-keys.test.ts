import { describe, expect, it } from "vitest";
import { queryKeys } from "../src/query-keys.ts";

describe("query keys", () => {
  it("builds the health, list and detail query keys", () => {
    expect(queryKeys.health).toEqual(["health"]);
    expect(queryKeys.issues("p1")).toEqual(["issues", "p1"]);
    expect(queryKeys.issue("p1", 7)).toEqual(["issues", "p1", 7]);
  });
});
