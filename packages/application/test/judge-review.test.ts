import { describe, expect, it } from "vitest";
import type { ReviewVerdict } from "@friday/contracts";
import { renderReviewBody, reviewEventFor } from "../src/index.ts";
import { A, TOKEN, rules, setup, verdict } from "./judge-helpers.ts";

describe("judge review", () => {
  it("renders the Rule/Answer/Evidence table and posts a review on the headSha", async () => {
    const shuffled = [...rules()].reverse();
    const body = renderReviewBody(verdict({ rules: shuffled }) as ReviewVerdict);
    const lines = body.split("\n");
    expect(lines.slice(0, 2)).toEqual(["| Rule | Answer | Evidence |", "|---|---|---|"]);
    expect(lines.slice(2)).toEqual([1, 2, 3, 4, 5].map((n) => `| ${n} | yes | ok-${n} |`));
    const tricky = rules();
    tricky[0] = { rule: 1, answer: "yes", evidence: "a|b\r\nc" };
    expect(renderReviewBody(verdict({ rules: tricky }) as ReviewVerdict).split("\n")[2]).toBe(
      "| 1 | yes | a\\|b c |",
    );
    expect(reviewEventFor("approve")).toBe("APPROVE");
    expect(reviewEventFor("changes_requested")).toBe("REQUEST_CHANGES");
    expect(reviewEventFor("reject")).toBe("REQUEST_CHANGES");

    const events: Array<[unknown, string]> = [
      [verdict(), "APPROVE"],
      [verdict({ verdict: "changes_requested", findings: ["f"] }), "REQUEST_CHANGES"],
      [verdict({ verdict: "reject", findings: ["f"] }), "REQUEST_CHANGES"],
    ];
    for (const [output, event] of events) {
      const s = setup(output);
      await s.run();
      expect(s.posted).toEqual([
        [30, { commitId: A, body: renderReviewBody(output as ReviewVerdict), event }],
      ]);
    }
  });

  it("posts with the configured token variable and never prints its value", async () => {
    const s = setup(verdict());
    const out = await s.run();
    expect(s.tokens).toEqual([TOKEN]);
    expect(JSON.stringify(s.runtime.requests)).not.toContain(TOKEN);
    expect(JSON.stringify(s.posted[0]?.[1].body)).not.toContain(TOKEN);
    expect(JSON.stringify(out)).not.toContain(TOKEN);

    const unset = setup(verdict(), { reviewTokenEnv: undefined });
    await expect(unset.run()).rejects.toThrow(
      "A chave pull_requests.review_token_env não está configurada.",
    );
    const empty = setup(verdict(), { env: {} });
    const err = await empty.run().catch((e: Error) => e);
    expect((err as Error).message).toBe("A variável de ambiente FRIDAY_JUDGE_TOKEN não está definida.");
    for (const x of [unset, empty]) {
      expect(x.runtime.requests).toHaveLength(0);
      expect(x.tokens).toHaveLength(0);
    }
    const blank = setup(verdict(), { env: { FRIDAY_JUDGE_TOKEN: "  " } });
    await expect(blank.run()).rejects.toThrow("FRIDAY_JUDGE_TOKEN não está definida");
  });

  it("propagates a postReview failure without marking the verdict stale", async () => {
    const s = setup(verdict(), { postFail: new Error("falha 422") });
    await expect(s.run()).rejects.toThrow("falha 422");
    expect(s.stale.marked).toHaveLength(0);
  });
});
