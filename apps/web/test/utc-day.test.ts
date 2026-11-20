import { describe, expect, it } from "vitest";
import { assertUtcDay, utcDay } from "../src/utc-day.ts";

describe("utc day", () => {
  it("uses the UTC day", () => {
    expect(utcDay(Date.parse("2026-11-19T23:59:59.999Z"))).toBe("2026-11-19");
    expect(utcDay(Date.parse("2026-11-20T00:00:00.000Z"))).toBe("2026-11-20");
  });

  it("assertUtcDay accepts real days and rejects the rest", () => {
    expect(assertUtcDay("2026-11-19")).toBeUndefined();
    expect(assertUtcDay("2024-02-29")).toBeUndefined();
    const invalid = [
      "",
      "2026-1-9",
      "20261119",
      "2026-11-19/../x",
      "2026-11-19?x=1",
      "2026-13-01",
      "2026-02-30",
      "2026-11-19 ",
    ];
    for (const day of invalid) {
      expect(() => assertUtcDay(day), JSON.stringify(day)).toThrow(RangeError);
      expect(() => assertUtcDay(day)).toThrow("Dia inválido: use o formato AAAA-MM-DD");
    }
  });
});
