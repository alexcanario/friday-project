import { QueryClient } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiHttpError, ApiRedirectError } from "../src/api-errors.ts";
import { HostCardView, saveHostToken } from "../src/HostCard.tsx";
import { hostCardStateOf, type HostCardState } from "../src/host-card-state.ts";

afterEach(() => vi.unstubAllGlobals());

const host = { name: "h1", baseUrl: "" };
const noop = () => undefined;
const view = (state: HostCardState) =>
  renderToString(<HostCardView host={host} state={state} onSaveToken={noop} />);

const projA = {
  id: "a/b",
  enabled: true,
  breakerOpen: false,
  activeRuns: 2,
  dayCostUsd: 1.5,
  anyCostUnknown: false,
};
const projC = {
  id: "c/d",
  enabled: null,
  breakerOpen: true,
  activeRuns: 1,
  dayCostUsd: 0.25,
  anyCostUnknown: true,
};
const field = (html: string, name: string): string =>
  new RegExp(`data-field="${name}"[^>]*>([^<]*)<`).exec(html)?.[1] ?? "";

describe("host card", () => {
  it("maps errors to offline, error and unauthorized and renders each state alone", () => {
    expect(hostCardStateOf({ status: "pending" })).toEqual({ kind: "loading" });
    expect(hostCardStateOf({ status: "error", error: new TypeError("x") })).toEqual({
      kind: "offline",
    });
    expect(hostCardStateOf({ status: "error", error: new ApiHttpError(500) })).toEqual({
      kind: "error",
    });
    expect(hostCardStateOf({ status: "error", error: new ApiHttpError(401) })).toEqual({
      kind: "unauthorized",
    });
    expect(hostCardStateOf({ status: "success", data: [projA] })).toEqual({
      kind: "ready",
      projects: [projA],
    });
    const texts = ["Carregando", "sem conexão", "Erro ao consultar o host", "Token necessário"];
    const kinds = ["loading", "offline", "error", "unauthorized"] as const;
    kinds.forEach((kind, i) => {
      const html = view({ kind });
      texts.forEach((t, j) => {
        if (j === i) expect(html).toContain(t);
        else expect(html).not.toContain(t);
      });
    });
    const html = view({ kind: "unauthorized" });
    expect(html).toContain('data-field="token"');
    expect(html).toContain("Salvar token");
    expect(html).not.toContain("value=");
  });

  it("shows the login message without the token form", () => {
    expect(hostCardStateOf({ status: "error", error: new ApiRedirectError(302) })).toEqual({
      kind: "login",
    });
    const html = view({ kind: "login" });
    expect(html).toContain("Sessão de login expirada. Recarregue a página para entrar de novo.");
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('data-field="token"');
    expect(view({ kind: "unauthorized" })).toContain('type="password"');
  });

  it("renders breaker, active runs, day cost and projects, with partial cost", () => {
    const html = view({ kind: "ready", projects: [projA, projC] });
    expect(field(html, "breaker")).toBe("aberto");
    expect(field(html, "active-runs")).toBe("3");
    expect(field(html, "day-cost")).toBe("$1.75 (parcial)");
    expect(html.match(/data-project="/g)).toHaveLength(2);
    const rows = html.split("<li ");
    expect(rows.find((r) => r.includes('data-project="a/b"'))).toContain("ligado");
    expect(rows.find((r) => r.includes('data-project="c/d"'))).toContain("desconhecido");
    const one = view({ kind: "ready", projects: [projA] });
    expect(field(one, "breaker")).toBe("fechado");
    expect(field(one, "day-cost")).toBe("$1.50");
    expect(one).not.toContain("(parcial)");
    const none = view({ kind: "ready", projects: [] });
    expect(none).toContain("Nenhum projeto.");
    expect(none).not.toContain("<li");
  });

  it("links each project with host and project in the URL", () => {
    const html = view({ kind: "ready", projects: [projA] });
    expect(html).toContain('href="?host=h1&amp;project=a%2Fb"');
  });

  it("saves the token per host and refetches the card", () => {
    const data = new Map<string, string>();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    });
    const invalidateQueries = vi.fn(() => Promise.resolve());
    saveHostToken({ invalidateQueries } as Pick<QueryClient, "invalidateQueries">, "h1", "t9");
    expect(data.get("friday.panelToken.h1")).toBe("t9");
    expect(invalidateQueries).toHaveBeenCalledTimes(1);
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ["overview", "h1"] });
    const html = view({ kind: "unauthorized" });
    expect(html).toContain("<form");
    expect(html).toContain('name="token"');
  });
});
