import { describe, expect, it } from "vitest";
import { STATE_ROLES } from "../src/state-dispatcher.ts";

describe("STATE_ROLES", () => {
  it("maps InProgress to the specialist role", () => {
    expect(STATE_ROLES.InProgress).toBe("specialist");
  });
});
