import type { ApprovalItem, StatusResponse } from "@friday/contracts";
import type React from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ApprovalsView } from "../src/ApprovalsView.tsx";

type Props = Parameters<typeof ApprovalsView>[0];

const mk = (id: string, headSha: string, pr: number): ApprovalItem => ({
  id,
  issueId: 14,
  pr,
  headSha,
  tier: "low",
  requestedAt: 1,
  expiresAt: 2,
});
const closed: StatusResponse = { enabled: null, breaker: { open: false, openedAt: null, failures: [] } };
const base: Props = {
  approvals: [mk("a2", "def456", 6), mk("a1", "abc123", 5)],
  status: closed,
  hasToken: true,
  message: null,
  onApprove: () => undefined,
  onDeny: () => undefined,
};
const html = (p: Partial<Props> = {}) => renderToString(ApprovalsView({ ...base, ...p }));
const count = (s: string, needle: string) => s.split(needle).length - 1;
const row = (s: string, id: string) => {
  const start = s.indexOf(`<li data-approval-id="${id}"`);
  return s.slice(start, s.indexOf("</li>", start));
};

describe("ApprovalsView", () => {
  it("lists each pending approval with its head sha and shows the empty message", () => {
    const s = html();
    expect(count(s, "data-approval-id=")).toBe(2);
    expect(s.indexOf('data-approval-id="a2"')).toBeLessThan(s.indexOf('data-approval-id="a1"'));
    expect(row(s, "a1")).toContain('<span data-field="head-sha">abc123</span>');
    expect(row(s, "a1")).toContain("PR #5");
    expect(row(s, "a2")).toContain("def456");
    const empty = html({ approvals: [] });
    expect(empty).toContain("Nenhum pedido pendente.");
    expect(count(empty, "data-approval-id=")).toBe(0);
  });

  it("disables both buttons without a token", () => {
    const off = html({ hasToken: false });
    for (const id of ["a1", "a2"]) {
      expect(row(off, id)).toMatch(/<button[^>]*disabled[^>]*data-action="approve"|<button[^>]*data-action="approve"[^>]*disabled/);
      expect(row(off, id)).toMatch(/<button[^>]*disabled[^>]*data-action="deny"|<button[^>]*data-action="deny"[^>]*disabled/);
    }
    expect(count(off, "disabled")).toBe(4);
    expect(count(html(), "disabled")).toBe(0);
  });

  it("calls onApprove and onDeny with the approval id", () => {
    const onApprove = vi.fn();
    const onDeny = vi.fn();
    const tree = ApprovalsView({ ...base, onApprove, onDeny });
    const buttons: { props: { "data-action"?: string; onClick?: () => void } }[] = [];
    const lis: React.ReactElement<{ "data-approval-id"?: string }>[] = [];
    const walk = (n: unknown): void => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (n === null || typeof n !== "object") return;
      const el = n as React.ReactElement<{ children?: unknown }>;
      if (el.type === "li") lis.push(el as never);
      if (el.type === "button") buttons.push(el as never);
      walk(el.props?.children);
    };
    walk(tree);
    const li = lis.find((l) => l.props["data-approval-id"] === "a1");
    expect(li).toBeDefined();
    buttons.length = 0;
    walk(li);
    buttons.find((b) => b.props["data-action"] === "approve")?.props.onClick?.();
    expect(onApprove).toHaveBeenCalledTimes(1);
    expect(onApprove).toHaveBeenCalledWith("a1");
    expect(onDeny).toHaveBeenCalledTimes(0);
    buttons.find((b) => b.props["data-action"] === "deny")?.props.onClick?.();
    expect(onDeny).toHaveBeenCalledWith("a1");
  });

  it("shows enabled and breaker state without any control", () => {
    const section = (s: string) => s.slice(s.indexOf('data-section="status"'));
    const open = html({
      status: {
        enabled: true,
        breaker: { open: true, openedAt: "2026-11-05T01:00:00.000Z", failures: ["x", "y"] },
      },
    });
    for (const t of ["ligado", "aberto", "2026-11-05T01:00:00.000Z"]) expect(open).toContain(t);
    expect(count(section(open).slice(section(open).indexOf('data-list="failures"')), "<li")).toBe(2);
    const off = html({ status: { enabled: false, breaker: closed.breaker } });
    for (const t of ["desligado", "fechado", '<span data-field="opened-at">—</span>'])
      expect(off).toContain(t);
    expect(count(section(off).slice(section(off).indexOf('data-list="failures"')), "<li")).toBe(0);
    const unknown = html();
    expect(unknown).toContain("desconhecido");
    for (const s of [open, off, unknown]) {
      const sec = section(s);
      for (const bad of ["<button", "<input", "<select"]) expect(sec).not.toContain(bad);
    }
  });

  it("shows the decision message only when present", () => {
    const s = html({ message: "Pedido rejeitado." });
    expect(s).toContain('data-field="message">Pedido rejeitado.<');
    expect(html({ message: null })).not.toContain('data-field="message"');
  });
});
