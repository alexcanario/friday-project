import { describe, expect, it } from "vitest";
import { projectItem } from "../src/index.ts";

describe("projectItem", () => {
  it("accepts a project id and rejects empty, numeric and missing ids", () => {
    expect(projectItem.safeParse({ id: "owner/repo" }).success).toBe(true);
    expect(projectItem.safeParse({ id: "" }).success).toBe(false);
    expect(projectItem.safeParse({ id: 1 }).success).toBe(false);
    expect(projectItem.safeParse({}).success).toBe(false);
  });
});
