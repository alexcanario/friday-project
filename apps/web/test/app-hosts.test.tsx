import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { App } from "../src/App.tsx";
import type { ApiClient } from "../src/api.ts";

const client: ApiClient = {
  fetchHealth: () => Promise.resolve({ status: "ok" }),
  fetchProjects: () => Promise.resolve([]),
  fetchProjectOverview: () => Promise.reject(new Error("unused")),
  fetchIssues: () => Promise.resolve([]),
  fetchRuns: () => Promise.resolve([]),
};
const hostClient: ApiClient = {
  ...client,
  fetchIssues: () => new Promise(() => undefined),
  fetchRuns: () => new Promise(() => undefined),
};
const hosts = [
  { name: "h1", baseUrl: "" },
  { name: "h2", baseUrl: "" },
];

function render(search: string, hostList: typeof hosts | null = hosts) {
  const clientFor = vi.fn(() => hostClient);
  const html = renderToString(
    <QueryClientProvider client={new QueryClient()}>
      <App client={client} hosts={hostList} search={search} clientFor={clientFor} />
    </QueryClientProvider>,
  );
  return { html, clientFor };
}

describe("app with hosts", () => {
  it("selects host and project from the URL and renders the project screen with the host client", () => {
    let r = render("?host=h1&project=a%2Fb");
    expect(r.html).toContain('data-view="project"');
    expect(r.html).toContain("Projeto a/b em h1");
    expect(r.html).toContain('data-action="back"');
    expect(r.html).toContain('data-slot="approvals"');
    expect(r.html).not.toContain("data-host-card=");
    expect(r.clientFor).toHaveBeenCalledTimes(1);
    expect(r.clientFor).toHaveBeenCalledWith(hosts[0]);
    r = render("?host=zzz&project=a%2Fb");
    expect(r.html).toContain("Host desconhecido: zzz.");
    expect(r.html).not.toContain('data-view="project"');
    expect(r.html).not.toContain("data-host-card=");
    expect(r.clientFor).toHaveBeenCalledTimes(0);
    r = render("");
    expect(r.html).not.toContain('data-view="project"');
    expect(r.clientFor).toHaveBeenCalledTimes(2);
    expect(render("", null).html).toContain("Não foi possível ler a lista de hosts.");
  });
});
