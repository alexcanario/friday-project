import { describe, expect, it, vi } from "vitest";
import { setup, verdict } from "./judge-helpers.ts";

const EMPTY = "O token de revisão do App está vazio.";

describe("runJudgeStep with the app credential", () => {
  it("posts the review with a fresh token from the app provider", async () => {
    const getToken = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("tok-a")
      .mockResolvedValue("tok-b");
    const s = setup(verdict(), { review: { mode: "app", getToken } });
    const out = await s.run();
    expect(s.tokens).toEqual(["tok-b"]);
    expect(s.posted).toHaveLength(1);
    expect(out.kind).toBe("approved");
    for (const t of ["tok-a", "tok-b"]) {
      expect(JSON.stringify(s.runtime.requests)).not.toContain(t);
      expect(JSON.stringify(s.posted[0]?.[1].body)).not.toContain(t);
      expect(JSON.stringify(out)).not.toContain(t);
    }
  });

  it("rejects an empty or failing app token before posting", async () => {
    for (const first of ["", "   "]) {
      const s = setup(verdict(), { review: { mode: "app", getToken: async () => first } });
      await expect(s.run()).rejects.toThrow(EMPTY);
      expect(s.runtime.requests).toHaveLength(0);
      expect(s.tokens).toHaveLength(0);
    }

    const failing = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("tok-a")
      .mockRejectedValue(new Error("falha na renovação"));
    const f = setup(verdict(), { review: { mode: "app", getToken: failing } });
    await expect(f.run()).rejects.toThrow("falha na renovação");
    expect(f.tokens).toHaveLength(0);
    expect(f.posted).toHaveLength(0);
    expect(f.stale.marked).toHaveLength(0);

    const blank = vi
      .fn<() => Promise<string>>()
      .mockResolvedValueOnce("tok-a")
      .mockResolvedValue("");
    const b = setup(verdict(), { review: { mode: "app", getToken: blank } });
    await expect(b.run()).rejects.toThrow(EMPTY);
    expect(b.tokens).toHaveLength(0);
    expect(b.posted).toHaveLength(0);
    expect(b.stale.marked).toHaveLength(0);
  });
});
