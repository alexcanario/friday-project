import { describe, expect, it } from "vitest";
import { utcDay } from "../src/utc-day.ts";

describe("utc day", () => {
  it("uses the UTC day", () => {
    expect(utcDay(Date.parse("2026-11-19T23:59:59.999Z"))).toBe("2026-11-19");
    expect(utcDay(Date.parse("2026-11-20T00:00:00.000Z"))).toBe("2026-11-20");
  });
});
