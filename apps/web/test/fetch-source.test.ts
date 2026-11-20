import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFetchSource } from "../src/fetch-source.ts";

const URL_ = "/events/stream?project=p1";
const encoder = new TextEncoder();

function streamBody(chunks: string[], end = true): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        if (end) controller.close();
      },
    }),
    { status: 200 },
  );
}

function opaqueRedirect(): Response {
  return { status: 0, type: "opaqueredirect", ok: false, body: null } as unknown as Response;
}

type Call = [string, { headers: Record<string, string>; signal: AbortSignal; redirect: string }];

function calls(fetchImpl: ReturnType<typeof vi.fn>): Call[] {
  return fetchImpl.mock.calls as unknown as Call[];
}

interface Seen {
  type: string;
  data?: unknown;
}

function listen(source: ReturnType<typeof createFetchSource>, types: string[]): Seen[] {
  const seen: Seen[] = [];
  for (const type of types) {
    source.addEventListener(type, (event) => seen.push({ type, data: event.data }));
  }
  return seen;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetch source", () => {
  it("sends x-friday-token, keeps it out of the URL and opens on 200", async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(streamBody([], false)));
    const source = createFetchSource(URL_, "tok", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen = listen(source, ["open"]);
    expect(source.readyState).toBe(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = calls(fetchImpl)[0] as Call;
    expect(url).toBe(URL_);
    expect(url).not.toContain("tok");
    expect(Object.keys(init).sort()).toEqual(["headers", "redirect", "signal"]);
    expect(init.redirect).toBe("manual");
    expect(init.headers["x-friday-token"]).toBe("tok");
    expect("last-event-id" in init.headers).toBe(false);
    expect(seen.map((s) => s.type)).toEqual(["open"]);
    expect(source.readyState).toBe(1);
    source.close();
  });

  it("decodes SSE frames split across chunks and resumes with last-event-id", async () => {
    const json = JSON.stringify({ issueId: 7, from: "ready", to: "in-progress", heldReason: null });
    const wire = `id: 5\nevent: stage_changed\ndata: ${json}\n\n`;
    const second = `event: stage_changed\ndata: ${json}\n\n`;
    const cut = wire.indexOf("stage_changed") + 4;
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamBody([wire.slice(0, cut), wire.slice(cut, -1), "\n", second]))
      .mockResolvedValue(streamBody([], false));
    const source = createFetchSource(URL_, "tok", { fetchImpl: fetchImpl as unknown as typeof fetch });
    const seen = listen(source, ["stage_changed", "error"]);
    await vi.advanceTimersByTimeAsync(0);
    const frames = seen.filter((s) => s.type === "stage_changed");
    expect(frames).toEqual([
      { type: "stage_changed", data: json },
      { type: "stage_changed", data: json },
    ]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect("last-event-id" in (calls(fetchImpl)[0] as Call)[1].headers).toBe(false);
    expect((calls(fetchImpl)[1] as Call)[1].headers["last-event-id"]).toBe("5");
    source.close();
  });

  it("ignores ids that are not numeric", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(streamBody(["id: 3\ndata: x\n\n", "id: abc\ndata: y\n\n"]))
      .mockResolvedValue(streamBody([], false));
    const source = createFetchSource(URL_, "tok", { fetchImpl: fetchImpl as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(1000);
    expect((calls(fetchImpl)[1] as Call)[1].headers["last-event-id"]).toBe("3");
    source.close();
  });

  it("401, 403 and 404 stop without reconnecting", async () => {
    for (const status of [401, 403, 404]) {
      const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status })));
      const source = createFetchSource(URL_, "tok", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const seen = listen(source, ["error", "open"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toEqual([{ type: "error", data: undefined }]);
      expect(source.readyState).toBe(2);
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
    for (const response of [opaqueRedirect(), new Response(null, { status: 429 })]) {
      const fetchImpl = vi.fn(() => Promise.resolve(response));
      const source = createFetchSource(URL_, "tok", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const seen = listen(source, ["error"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);
      expect(source.readyState).toBe(2);
      await vi.advanceTimersByTimeAsync(10000);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it("500, 503, missing body, ended body and network error retry after retryMs", async () => {
    const makers: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response(null, { status: 500 })),
      () => Promise.resolve(new Response(null, { status: 503 })),
      () => Promise.resolve({ status: 200, ok: true, body: null } as unknown as Response),
      () => Promise.resolve(streamBody([": hi\n\n"])),
      () => Promise.reject(new Error("network down")),
    ];
    for (const make of makers) {
      const fetchImpl = vi.fn(make);
      const source = createFetchSource(URL_, "tok", {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      });
      const seen = listen(source, ["error"]);
      await vi.advanceTimersByTimeAsync(0);
      expect(seen).toHaveLength(1);
      expect(source.readyState).toBe(0);
      await vi.advanceTimersByTimeAsync(998);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(2);
      expect(fetchImpl).toHaveBeenCalledTimes(2);
      source.close();
    }
    const fetchImpl = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const source = createFetchSource(URL_, "tok", {
      fetchImpl: fetchImpl as unknown as typeof fetch,
      retryMs: 50,
    });
    await vi.advanceTimersByTimeAsync(49);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    source.close();
  });

  it("close aborts the request and stops retries", async () => {
    const pending = vi.fn(() => new Promise<Response>(() => undefined));
    const early = createFetchSource(URL_, "tok", { fetchImpl: pending as unknown as typeof fetch });
    const earlySeen = listen(early, ["error", "open"]);
    early.close();
    expect(early.readyState).toBe(2);
    expect((calls(pending)[0] as Call)[1].signal.aborted).toBe(true);

    const open = vi.fn(() => Promise.resolve(streamBody([], false)));
    const live = createFetchSource(URL_, "tok", { fetchImpl: open as unknown as typeof fetch });
    await vi.advanceTimersByTimeAsync(0);
    live.close();
    expect(live.readyState).toBe(2);
    expect((calls(open)[0] as Call)[1].signal.aborted).toBe(true);

    const failing = vi.fn(() => Promise.resolve(new Response(null, { status: 500 })));
    const waiting = createFetchSource(URL_, "tok", {
      fetchImpl: failing as unknown as typeof fetch,
    });
    const waitingSeen = listen(waiting, ["error", "open"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(waitingSeen).toHaveLength(1);
    waiting.close();
    await vi.advanceTimersByTimeAsync(10000);
    expect(failing).toHaveBeenCalledTimes(1);
    expect(waitingSeen).toHaveLength(1);
    expect(waiting.readyState).toBe(2);
    expect(earlySeen).toEqual([]);
    expect(pending).toHaveBeenCalledTimes(1);
  });

  it("never logs or emits the token", async () => {
    const spies = (["log", "warn", "error"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => undefined),
    );
    const makers: (() => Promise<Response>)[] = [
      () => Promise.resolve(new Response(null, { status: 401 })),
      () => Promise.resolve(new Response(null, { status: 500 })),
      () => Promise.reject(new Error("network down")),
    ];
    for (const make of makers) {
      const source = createFetchSource(URL_, "tok", {
        fetchImpl: vi.fn(make) as unknown as typeof fetch,
      });
      const seen = listen(source, ["error", "open"]);
      await vi.advanceTimersByTimeAsync(1500);
      expect(seen.length).toBeGreaterThan(0);
      for (const event of seen) expect(JSON.stringify(event)).not.toContain("tok");
      source.close();
    }
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });
});
