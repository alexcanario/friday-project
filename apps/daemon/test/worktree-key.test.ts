import { describe, expect, it } from "vitest";
import { worktreeKeyOf } from "../src/index.ts";

describe("worktreeKeyOf", () => {
  it("replaces the slash with a double underscore and keeps a key without slash", () => {
    expect(worktreeKeyOf("acme/widgets")).toBe("acme__widgets");
    expect(worktreeKeyOf("p")).toBe("p");
  });
});
