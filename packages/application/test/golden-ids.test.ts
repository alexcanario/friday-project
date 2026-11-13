import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { plantedIdsOf, type SeedItem } from "../src/index.ts";

describe("plantedIdsOf", () => {
  it("plantedIdsOf reads 8 planted items, 2 per kind, from the seed manifest", () => {
    const raw = readFileSync(
      resolve(import.meta.dirname, "../../../registry/sandbox/seed-issues.json"),
      "utf8",
    );
    const parsed = JSON.parse(raw) as { items?: SeedItem[] } | SeedItem[];
    const items = Array.isArray(parsed) ? parsed : (parsed.items ?? []);
    const ids = plantedIdsOf(items);
    expect(new Set(ids).size).toBe(8);
    expect(ids).toHaveLength(8);
    const kinds = items.filter((i) => ids.includes(i.id)).map((i) => i.plantedDefect?.kind);
    for (const kind of ["criterion_unmet", "weakened_test", "secret_leak", "out_of_scope"]) {
      expect(kinds.filter((k) => k === kind)).toHaveLength(2);
    }
  });

  it("returns only the planted id from an inline list and [] for an empty list", () => {
    const d = { kind: "secret_leak", description: "x" };
    expect(
      plantedIdsOf([
        { id: "A", plantedDefect: null },
        { id: "B", plantedDefect: d },
        { id: "C", plantedDefect: null },
      ]),
    ).toEqual(["B"]);
    expect(plantedIdsOf([])).toEqual([]);
  });
});
