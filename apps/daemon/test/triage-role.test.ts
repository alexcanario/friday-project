import { describe, expect, it } from "vitest";
import { STATE_ROLES } from "../src/index.ts";

describe("triage role", () => {
  it("maps Todo and Triage to the triage role", () => {
    expect(STATE_ROLES.Todo).toBe("triage");
    expect(STATE_ROLES.Triage).toBe("triage");
  });
});
