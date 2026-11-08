import { describe, expect, it } from "vitest";
import {
  buildNightDigest,
  type NightComment,
  type NightIssue,
  type NightPull,
  type NightReader,
} from "../src/night-digest.ts";

interface Fake {
  comments?: Record<number, NightComment[]>;
  issues?: Record<string, NightIssue[]>;
  closed?: NightPull[];
  open?: NightPull[];
}

function reader(f: Fake = {}): NightReader {
  return {
    listComments: async (n) => f.comments?.[n] ?? [],
    listOpenIssues: async (label) => f.issues?.[label] ?? [],
    listClosedPulls: async () => f.closed ?? [],
    listOpenPulls: async () => f.open ?? [],
  };
}

const c = (body: string, createdAt: string): NightComment => ({ body, createdAt });
const pull = (over: Partial<NightPull>): NightPull => ({
  number: 12,
  title: "feat: x (#7)",
  body: "Closes #7",
  mergedAt: "2026-11-08T03:00:00Z",
  baseRef: "develop",
  ...over,
});

describe("buildNightDigest", () => {
  it("finds since and the phases A and B after the last night header", async () => {
    const d = await buildNightDigest(
      reader({
        comments: {
          1: [
            c("## Noite de 05/11", "2026-11-05T00:00:00Z"),
            c("Fase A: refinadas #1", "2026-11-05T01:00:00Z"),
            c("## Noite de 06/11", "2026-11-06T00:00:00Z"),
            c("Fase B: implementadas #2", "2026-11-06T01:00:00Z"),
          ],
        },
      }),
      1,
    );
    expect(d.since).toBe("2026-11-06T00:00:00Z");
    expect(d.phases).toEqual({ A: false, B: true });

    const none = await buildNightDigest(
      reader({ comments: { 1: [c("Fase A: x", "2026-11-05T01:00:00Z")] } }),
      1,
    );
    expect(none.since).toBeNull();
    expect(none.phases.A).toBe(true);

    const variants = await buildNightDigest(
      reader({
        comments: {
          1: [
            c("**Fase A (refinar), 08/11:** refinadas #246", "2026-11-08T01:00:00Z"),
            c("Fase B (implementação): 3 de 3", "2026-11-08T02:00:00Z"),
          ],
        },
      }),
      1,
    );
    expect(variants.phases).toEqual({ A: true, B: true });

    const note = await buildNightDigest(
      reader({ comments: { 1: [c("Nota: Fase A: x", "2026-11-08T01:00:00Z")] } }),
      1,
    );
    expect(note.phases.A).toBe(false);
  });

  it("lists only merged PRs into develop after since", async () => {
    const d = await buildNightDigest(
      reader({
        comments: { 1: [c("## Noite de 07/11", "2026-11-08T00:00:00Z")] },
        closed: [
          pull({}),
          pull({ number: 13, mergedAt: "2026-11-07T00:00:00Z" }),
          pull({ number: 14, mergedAt: null }),
          pull({ number: 15, baseRef: "main" }),
          pull({ number: 16, body: "sem link", title: "chore: y" }),
        ],
      }),
      1,
    );
    expect(d.merges).toEqual([
      { issue: 7, pr: 12, title: "feat: x (#7)" },
      { issue: null, pr: 16, title: "chore: y" },
    ]);
  });

  it("nightStop is true only with an open night:stop issue", async () => {
    expect((await buildNightDigest(reader(), 1)).nightStop).toBe(false);
    const d = await buildNightDigest(
      reader({ issues: { "night:stop": [{ number: 9, title: "stop", labels: [] }] } }),
      1,
    );
    expect(d.nightStop).toBe(true);
  });

  it("returns ready and review issues", async () => {
    const d = await buildNightDigest(
      reader({
        issues: {
          "status:ready": [{ number: 3, title: "a", labels: ["status:ready"] }],
          "status:review": [{ number: 4, title: "b", labels: ["status:review"] }],
        },
      }),
      1,
    );
    expect(d.ready).toEqual([{ number: 3, title: "a" }]);
    expect(d.review).toEqual([{ number: 4, title: "b" }]);
  });

  it("lists stuck PRs with gates and the last visible reason", async () => {
    const d = await buildNightDigest(
      reader({
        open: [
          pull({ number: 30, body: "Closes #8", mergedAt: null }),
          pull({ number: 31, body: "Closes #9", mergedAt: null }),
        ],
        issues: {
          "status:needs-human": [
            { number: 8, title: "i", labels: ["status:needs-human", "gate:budget"] },
          ],
        },
        comments: {
          8: [
            c("Teto estourado\nmais detalhe", "2026-11-08T01:00:00Z"),
            c("<!-- friday:result {} -->", "2026-11-08T02:00:00Z"),
          ],
        },
      }),
      1,
    );
    expect(d.stuckPrs).toEqual([
      { pr: 30, issue: 8, gates: ["gate:budget"], reason: "Teto estourado" },
    ]);
  });
});
