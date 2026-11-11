import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { checkSeedManifest } from "./seed-manifest.ts";

const file = resolve(import.meta.dirname, "../../../registry/sandbox/seed-issues.json");
const raw = readFileSync(file, "utf8");

type Item = {
  id: string;
  title: string;
  body: string;
  criteria: string[];
  plantedDefect: { kind: string; description: string } | null;
};
const items = JSON.parse(raw) as Item[];

function make(n: number): Item[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `S${i + 1}`,
    title: "t",
    body: "b",
    criteria: ["c"],
    plantedDefect: null,
  }));
}

describe("sandbox seed manifest", () => {
  it("seed manifest has 20 valid issues including S1 to S3", () => {
    expect(checkSeedManifest(items)).toEqual({ ok: true, count: 20 });
    const byId = (id: string) => items.find((i) => i.id === id);
    expect(byId("S1")?.title).toContain("GET /version");
    expect(byId("S2")?.title).toContain("CalculateTax");
    expect(byId("S3")?.title).toContain("Blazor");
  });

  it("seed has 8 planted defects, 2 per kind, and 12 clean controls", () => {
    const planted = items.filter((i) => i.plantedDefect !== null);
    expect(planted).toHaveLength(8);
    expect(items.filter((i) => i.plantedDefect === null)).toHaveLength(12);
    const kinds = ["criterion_unmet", "weakened_test", "secret_leak", "out_of_scope"];
    for (const kind of kinds) {
      expect(planted.filter((i) => i.plantedDefect?.kind === kind)).toHaveLength(2);
    }
    for (const i of planted) {
      const d = i.plantedDefect!;
      expect(d.kind.trim()).not.toBe("");
      expect(d.description.trim()).not.toBe("");
      expect(kinds).toContain(d.kind);
      expect(i.title).not.toContain(d.description);
      expect(i.body).not.toContain(d.description);
      for (const c of i.criteria) expect(c).not.toContain(d.description);
    }
    expect(raw).not.toMatch(/sk-ant-[A-Za-z0-9_-]{20,}/);
    expect(raw).not.toMatch(/ghp_[A-Za-z0-9]{20,}/);
  });

  it("checkSeedManifest rejects invalid manifests and accepts valid ones", () => {
    const bad = (v: unknown) => {
      const r = checkSeedManifest(v);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problems.length).toBeGreaterThan(0);
    };
    bad(make(14));
    bad(make(21));
    const noCriteria = make(15);
    delete (noCriteria[0] as Partial<Item>).criteria;
    bad(noCriteria);
    const empty = make(15);
    empty[0]!.criteria = [];
    bad(empty);
    const dup = make(15);
    dup[1]!.id = "S1";
    bad(dup);
    const kind = make(15);
    kind[0]!.plantedDefect = { kind: "", description: "d" };
    bad(kind);
    expect(checkSeedManifest(make(15))).toEqual({ ok: true, count: 15 });
    expect(checkSeedManifest(make(20))).toEqual({ ok: true, count: 20 });
  });
});
