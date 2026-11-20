import type { RunItem, RunReview } from "@friday/contracts";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RunDetailView } from "../src/RunDetailView.tsx";
import { runDetailMessage, type RunDetailState } from "../src/run-detail-state.ts";

const host = { name: "h1", baseUrl: "" };
type Props = ComponentProps<typeof RunDetailView>;

const run: RunItem = {
  id: "r2",
  issueId: 14,
  phase: "implement",
  status: "running",
  startedAt: null,
  finishedAt: null,
  costUsd: 0.5,
  numTurns: 3,
};
const review: RunReview = {
  judge: { outcome: "reject", reviewId: 1, feedback: "Falta teste", at: "2026-11-19T10:00:00Z" },
  pr: { number: 7 },
};

function view(over: Partial<Props> = {}): string {
  return renderToString(
    <RunDetailView
      host={host}
      project="o/r"
      runId="r2"
      state="ready"
      run={run}
      review={review}
      {...over}
    />,
  );
}

describe("run detail view", () => {
  it("renders header, fields, verdict, feedback and PR link", () => {
    const html = view();
    expect(html).toContain('data-view="run"');
    expect(html).toContain('data-field="run-title">Run r2 de o/r em h1<');
    expect(html).toContain('<a data-action="back" href="?host=h1&amp;project=o%2Fr">Voltar ao projeto</a>');
    expect(html).toContain('data-field="status">running<');
    expect(html).toContain('data-field="cost">$0.50<');
    expect(html).toContain('data-field="turns">3<');
    expect(html).toContain('data-field="judge">Rejeitado<');
    expect(html).toContain('data-field="feedback">Falta teste<');
    expect(html).toContain(
      '<a data-field="pr" href="https://github.com/o/r/pull/7" target="_blank" rel="noopener noreferrer">PR #7</a>',
    );
    for (const bad of ["<!--", "NaN", "undefined", "null"]) expect(html).not.toContain(bad);
  });

  it("renders dashes, every verdict, no verdict, no PR and escapes feedback", () => {
    const dashes = view({ run: { ...run, costUsd: null, numTurns: null } });
    expect(dashes).toContain('data-field="cost">—<');
    expect(dashes).toContain('data-field="turns">—<');
    expect(dashes).not.toContain("$0.00");
    const judge = (outcome: "approve" | "reject" | "changes_requested") =>
      view({ review: { ...review, judge: { ...review.judge!, outcome } } });
    expect(judge("approve")).toContain("Aprovado");
    expect(judge("changes_requested")).toContain("Mudanças solicitadas");
    const none = view({ review: { judge: null, pr: null } });
    expect(none).toContain('<p data-field="judge">Sem veredito do Judge.</p>');
    expect(none).not.toContain('data-field="feedback"');
    expect(none).toContain('<p data-field="pr">Sem PR.</p>');
    expect(none).not.toContain('<a data-field="pr"');
    for (const feedback of [null, ""]) {
      const r = view({ review: { ...review, judge: { ...review.judge!, feedback } } });
      expect(r).not.toContain('data-field="feedback"');
    }
    const xss = view({
      review: { ...review, judge: { ...review.judge!, feedback: "<script>alert(1)</script>" } },
    });
    expect(xss).toContain("&lt;script&gt;");
    expect(xss).not.toContain("<script>");
  });

  it("never links a PR for a malicious project and sets rel on external links", () => {
    for (const project of ["javascript:alert(1)//x", "evil.com/x/y"]) {
      const html = view({ project });
      expect(html).toContain('<p data-field="pr">PR #7</p>');
      expect(html).not.toContain('<a data-field="pr"');
      expect(html).not.toContain('href="https://github.com');
      expect(html).not.toContain('href="javascript:');
    }
    const tags = (view().match(/<a [^>]*>/g) ?? []).filter((a) => a.includes('target="_blank"'));
    expect(tags.length).toBeGreaterThan(0);
    for (const a of tags) expect(a).toContain('rel="noopener noreferrer"');
  });

  it("shows only the message in non-ready states", () => {
    const states: RunDetailState[] = ["loading", "offline", "unauthorized", "not-found", "error"];
    for (const state of states) {
      const html = view({ state, run: null, review: null });
      expect(html).toContain(`data-field="message">${runDetailMessage(state) ?? ""}<`);
      expect(html).toContain('data-field="run-title"');
      expect(html).toContain('data-action="back"');
      for (const bad of ["status", "cost", "judge", "pr"]) {
        expect(html).not.toContain(`data-field="${bad}"`);
      }
    }
    expect(view()).not.toContain('data-field="message"');
  });
});
