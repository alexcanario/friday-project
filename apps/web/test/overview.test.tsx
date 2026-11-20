import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ApiClient } from "../src/api.ts";
import { HostCardView } from "../src/HostCard.tsx";
import { Overview } from "../src/Overview.tsx";

const client: ApiClient = {
  fetchHealth: () => Promise.resolve({ status: "ok" }),
  fetchProjects: () => Promise.resolve([]),
  fetchProjectOverview: () => Promise.reject(new Error("unused")),
};
const clientFor = () => client;
const hosts = [
  { name: "h1", baseUrl: "" },
  { name: "h2", baseUrl: "" },
];
const proj = {
  id: "a/b",
  enabled: true,
  breakerOpen: false,
  activeRuns: 4,
  dayCostUsd: 2,
  anyCostUnknown: false,
};
const render = (qc: QueryClient, list = hosts) =>
  renderToString(
    <QueryClientProvider client={qc}>
      <Overview hosts={list} clientFor={clientFor} />
    </QueryClientProvider>,
  );
const cardOf = (html: string, name: string): string =>
  html.split("<section ").find((s) => s.includes(`data-host-card="${name}"`)) ?? "";

describe("overview", () => {
  it("shows the empty text and the loading state", () => {
    const html = render(new QueryClient(), []);
    expect(html).toContain("Nenhum host cadastrado");
    expect(html).not.toContain("data-host-card=");
    const card = renderToString(
      <HostCardView host={hosts[0]!} state={{ kind: "loading" }} onSaveToken={() => undefined} />,
    );
    expect(card).toContain("Carregando");
  });

  it("renders one card per host and keeps the other cards when one has no data", () => {
    const qc = new QueryClient();
    qc.setQueryData(["overview", "h1"], [proj]);
    let html = render(qc);
    expect(html.match(/data-host-card="/g)).toHaveLength(2);
    expect(cardOf(html, "h1")).toContain('data-project="a/b"');
    expect(cardOf(html, "h2")).toContain("Carregando");
    qc.getQueryCache()
      .build(qc, { queryKey: ["overview", "h2"] })
      .setState({ status: "error", error: new TypeError("x"), fetchStatus: "idle" });
    html = render(qc);
    expect(cardOf(html, "h1")).toContain('data-project="a/b"');
    expect(cardOf(html, "h2")).toContain("sem conexão");
  });
});
