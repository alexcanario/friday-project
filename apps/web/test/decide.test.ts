import { QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApiClient } from "../src/api.ts";
import { decideAndRefresh, refreshHostData, runDecision, runExclusive } from "../src/decide.ts";
import { queryKeys } from "../src/query-keys.ts";
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
  it("decideAndRefresh invalidates the host keys after the decision", async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, "invalidateQueries");
    const expected = [
      { queryKey: ["approvals", "o/r", "h1"] },
      { queryKey: ["status", "o/r", "h1"] },
      { queryKey: ["issues", "o/r", "list", "h1"] },
      { queryKey: ["issues", "o/r", "runs", "h1"] },
    ];
    const check = (ordered: boolean) => {
      expect(spy).toHaveBeenCalledTimes(4);
      expect(spy.mock.calls.map((c) => c[0])).toEqual(expected);
      if (!ordered) return;
      const fetched = fetchMock.mock.invocationCallOrder[0]!;
      for (const order of spy.mock.invocationCallOrder) expect(fetched).toBeLessThan(order);
    };
    withToken();
    reply({ outcome: "merged" }, 200);
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve")).resolves.toBe(
      "Aprovado e mesclado.",
    );
    check(true);
    spy.mockClear();
    fetchMock.mockClear();
    reply({ outcome: "expired" }, 409);
    await decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve");
    check(true);
    spy.mockClear();
    fetchMock.mockClear();
    fetchMock.mockImplementation(() => Promise.reject(new Error("net")));
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "deny")).resolves.toBe(
      "Não foi possível enviar a decisão.",
    );
    check(true);
    spy.mockClear();
    store.clear();
    fetchMock.mockClear();
    await expect(decideAndRefresh(qc, client(), "h1", "o/r", "a1", "approve")).resolves.toBe(
      "Token do painel inválido.",
    );
    check(false);
    expect(fetchMock).toHaveBeenCalledTimes(0);
  });
});

describe("refreshHostData", () => {
  it("refreshHostData invalidates only that host and project", () => {
    const qc = new QueryClient();
    const keysOf = (project: string, host: string) => [
      queryKeys.approvals(project, host),
      queryKeys.status(project, host),
      queryKeys.projectIssues(project, host),
      queryKeys.projectRuns(project, host),
    ];
    const mine = keysOf("o/r", "h1");
    const others = [...keysOf("o/r", "h2"), ...keysOf("x/y", "h1")];
    for (const key of [...mine, ...others]) qc.setQueryData(key, []);
    void refreshHostData(qc, "o/r", "h1");
    for (const key of mine) expect(qc.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of others) expect(qc.getQueryState(key)?.isInvalidated).toBe(false);
  });
});

describe("runExclusive", () => {
  it("runExclusive runs one task at a time and releases the lock", async () => {
    const lock = { current: false };
    const task = vi.fn(() => Promise.resolve("done"));
    await expect(runExclusive(lock, task)).resolves.toBe("done");
    expect(task).toHaveBeenCalledTimes(1);
    expect(lock.current).toBe(false);
    const busy = { current: true };
    task.mockClear();
    await expect(runExclusive(busy, task)).resolves.toBeNull();
    expect(task).toHaveBeenCalledTimes(0);
    task.mockClear();
    const [first, second] = [runExclusive(lock, task), runExclusive(lock, task)];
    await expect(first).resolves.toBe("done");
    await expect(second).resolves.toBeNull();
    expect(task).toHaveBeenCalledTimes(1);
    const failing = () => Promise.reject(new Error("boom"));
    await expect(runExclusive(lock, failing)).rejects.toThrow();
    expect(lock.current).toBe(false);
  });
});
