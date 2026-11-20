import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";
import { decideAndRefresh, runDecision } from "../src/decide.ts";
import { readToken } from "../src/token.ts";

const store = new Map<string, string>();
const fetchMock = vi.fn();

beforeEach(() => {
  store.clear();
  fetchMock.mockReset();
  vi.stubGlobal("sessionStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const reply = (body: unknown, status: number) =>
  fetchMock.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify(body), { status })),
  );
const client = () => createApiClient("", () => readToken("h1"));
const withToken = () => store.set("friday.panelToken.h1", "s3cret");

describe("runDecision", () => {
  it("sends the stored token on approve and deny, skips without a token and maps network errors", async () => {
    withToken();
    reply({ outcome: "head_changed" }, 409);
    await expect(runDecision(client(), "h1", "a1", "approve")).resolves.toBe(
      "O PR mudou depois do pedido; o merge foi recusado.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/approvals/a1/approve",
      expect.objectContaining({
        headers: expect.objectContaining({ "x-friday-token": "s3cret" }),
      }),
    );
    await runDecision(client(), "h1", "a1", "deny");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/approvals/a1/deny");
    store.clear();
    fetchMock.mockClear();
    await expect(runDecision(client(), "h1", "a1", "approve")).resolves.toBe(
      "Token do painel inválido.",
    );
    expect(fetchMock).toHaveBeenCalledTimes(0);
    withToken();
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));
    await expect(runDecision(client(), "h1", "a1", "approve")).resolves.toBe(
      "Não foi possível enviar a decisão.",
    );
  });
});

describe("decideAndRefresh", () => {
  it("invalidates the approvals list after each decision", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const expected = { queryKey: ["approvals", "o/r"] };
    withToken();
    reply({ outcome: "merged" }, 200);
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve")).resolves.toBe(
      "Aprovado e mesclado.",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(expected);
    spy.mockClear();
    reply({ outcome: "expired" }, 409);
    await decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve");
    expect(spy).toHaveBeenCalledWith(expected);
    spy.mockClear();
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "deny")).resolves.toBe(
      "Não foi possível enviar a decisão.",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    store.clear();
    fetchMock.mockClear();
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve")).resolves.toBe(
      "Token do painel inválido.",
    );
    expect(spy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});
