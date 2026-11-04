import { describe, expect, it } from "vitest";
import { validateContract } from "../src/validate.ts";
import { pairs, SHA } from "./helpers.ts";

const ok = { summary: "ok", headSha: SHA, changedFiles: [], notDone: [] };

describe("workReport", () => {
  it("accepts a report and rejects bad fields", () => {
    expect(validateContract("workReport", ok).ok).toBe(true);
    expect(pairs("workReport", { ...ok, headSha: "a".repeat(39) })).toEqual([
      "invalid_head_sha@headSha",
    ]);
    expect(pairs("workReport", { ...ok, summary: " " })).toEqual(["invalid_value@summary"]);
    const rest: Record<string, unknown> = { ...ok };
    delete rest.notDone;
    expect(pairs("workReport", rest)).toEqual(["required_field@notDone"]);
    expect(pairs("workReport", { ...ok, changedFiles: [1] })).toEqual([
      "invalid_value@changedFiles.0",
    ]);
    expect(pairs("workReport", { ...ok, extra: 1 })).toEqual(["unknown_field@extra"]);
  });
});
