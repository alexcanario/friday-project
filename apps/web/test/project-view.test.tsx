import type { IssueItem, RunItem } from "@friday/contracts";
import type { ComponentProps } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProjectScreenView } from "../src/ProjectView.tsx";
import { projectMessage, type ProjectState } from "../src/project-state.ts";

const host = { name: "h1", baseUrl: "" };
type Props = ComponentProps<typeof ProjectScreenView>;

function view(over: Partial<Props> = {}): string {
  return renderToString(
    <ProjectScreenView
      host={host}
      project="o/r"
      state="ready"
      issues={[]}
      runs={[]}
      {...over}
    />,
  );
}

/** A "row" is the substring from `<li ` to the next `</li>`. */
function row(html: string, attr: string): string {
  const at = html.indexOf(attr);
  const start = html.lastIndexOf("<li ", at);
  return html.slice(start, html.indexOf("</li>", at));
}

const count = (html: string, part: string) => html.split(part).length - 1;
const issue = (issueId: number, state: string, heldReason: string | null = null): IssueItem => ({
  issueId,
  state,
  heldReason,
});

describe("project view", () => {
  it("renders issues in issueId order with state and heldReason", () => {
    const issues = [issue(14, "InProgress"), issue(13, "Todo", "budget")];
    const html = view({ issues });
    expect(count(html, "data-issue-id=")).toBe(2);
    expect(html.indexOf('data-issue-id="13"')).toBeLessThan(html.indexOf('data-issue-id="14"'));
    const r13 = row(html, 'data-issue-id="13"');
    expect(r13).toContain("#13");
    expect(r13).toContain("Todo");
    expect(r13).toContain("budget");
    const r14 = row(html, 'data-issue-id="14"');
    expect(r14).toContain("#14");
    expect(r14).toContain("InProgress");
    expect(r14).not.toContain("held-reason");
    expect(r14).not.toContain("null");
    expect(issues.map((i) => i.issueId)).toEqual([14, 13]);
  });

  it("renders the empty messages only for empty lists", () => {
    const empty = view();
    expect(empty).toContain("Nenhuma issue.");
    expect(empty).toContain("Nenhuma run.");
    expect(count(empty, "<li ")).toBe(0);
    const some = view({ issues: [issue(1, "Todo"), issue(2, "Todo")] });
    expect(some).toContain("Nenhuma run.");
    expect(some).not.toContain("Nenhuma issue.");
    expect(count(some, "data-issue-id=")).toBe(2);
  });

  it("renders run phase, cost and turns, with a dash for null", () => {
    const runs: RunItem[] = [
      {
        id: "r2",
        issueId: 14,
        phase: "implement",
        status: "running",
        startedAt: null,
        finishedAt: null,
        costUsd: 0.5,
        numTurns: 3,
      },
      {
        id: "r1",
        issueId: 13,
        phase: null,
        status: "failed",
        startedAt: null,
        finishedAt: null,
        costUsd: null,
        numTurns: null,
      },
    ];
    const html = view({ runs });
    const r2 = row(html, 'data-run-id="r2"');
    expect(r2).toContain("#14");
    expect(r2).toContain('data-field="phase">implement<');
    expect(r2).toContain('data-field="cost">$0.50<');
    expect(r2).toContain('data-field="turns">3<');
    const r1 = row(html, 'data-run-id="r1"');
    expect(r1).toContain('data-field="phase">—<');
    expect(r1).toContain('data-field="cost">—<');
    expect(r1).toContain('data-field="turns">—<');
    for (const bad of ["$0.00", "NaN", "<!--"]) expect(r1).not.toContain(bad);
    expect(html.indexOf('data-run-id="r2"')).toBeLessThan(html.indexOf('data-run-id="r1"'));
  });

  it("shows only the message in non-ready states and keeps header, back link and slot", () => {
    const states: ProjectState[] = ["loading", "offline", "unauthorized", "error", "ready"];
    for (const state of states) {
      const html = view({ state });
      if (state === "ready") {
        expect(html).not.toContain('data-field="message"');
      } else {
        expect(html).toContain('data-field="message"');
        expect(html).toContain(projectMessage(state) ?? "");
        for (const bad of [
          'data-list="issues"',
          'data-list="runs"',
          "Nenhuma issue.",
          "Nenhuma run.",
        ]) {
          expect(html).not.toContain(bad);
        }
      }
      expect(html).toContain("Projeto o/r em h1");
      expect(html).toContain('<a data-action="back" href="?">Voltar à visão geral</a>');
      expect(html).toContain('data-slot="approvals"');
    }
  });

  it("renders the approvals slot after both lists", () => {
    const html = view({ approvals: <p data-test="x">APROV</p> });
    const slot = html.indexOf('data-slot="approvals"');
    expect(slot).toBeGreaterThan(html.indexOf('data-list="issues"'));
    expect(slot).toBeGreaterThan(html.indexOf('data-list="runs"'));
    expect(html).toMatch(/<section data-slot="approvals">.*APROV.*<\/section>/);
    expect(view()).toContain('<section data-slot="approvals"></section>');
  });
});
