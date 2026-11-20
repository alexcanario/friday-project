import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionState } from "../src/connection-state.ts";
import { subscribeLiveEvents, type LiveSource } from "../src/live-events.ts";

type Listener = (event: { data?: unknown }) => void;

class FakeSource implements LiveSource {
  readyState = 1;
  closed = 0;
  readonly listeners = new Map<string, Listener[]>();
  readonly url: string;
  constructor(url: string) {
    this.url = url;
  }
  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  close(): void {
    this.closed += 1;
  }
  emit(type: string, event: { data?: unknown } = {}): void {
    (this.listeners.get(type) ?? []).forEach((l) => l(event));
  }
}

function setup(baseUrl = "", project: string | undefined = "p1") {
  const sources: FakeSource[] = [];
  const invalidateQueries = vi.fn();
  const states: ConnectionState[] = [];
  const stop = subscribeLiveEvents({
    baseUrl,
    project,
    queryClient: { invalidateQueries },
    onState: (s) => states.push(s),
    createSource: (url) => {
      const s = new FakeSource(url);
      sources.push(s);
      return s;
    },
  });
  return { sources, invalidateQueries, states, stop };
}

const frame = (value: unknown) => ({ data: JSON.stringify(value) });

describe("live events", () => {
  it("builds the stream URL from base and encoded project", () => {
    expect(setup("", "a b").sources[0]?.url).toBe("/events/stream?project=a%20b");
    expect(setup("https://api.example", "p1").sources[0]?.url).toBe(
      "https://api.example/events/stream?project=p1",
    );
  });

  it("invalidates list and detail on each valid frame", () => {
    const { sources, invalidateQueries } = setup();
    const frames: [string, unknown][] = [
      ["stage_changed", { issueId: 7, from: "ready", to: "in-progress", heldReason: null }],
      ["run_finished", { issueId: 7, runId: "r1" }],
      ["cost_updated", { issueId: 7, costUsd: 1.5, anyCostUnknown: false }],
    ];
    for (const [type, body] of frames) {
      invalidateQueries.mockClear();
      sources[0]?.emit(type, frame(body));
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["issues", "p1"] }),
      );
      expect(invalidateQueries).toHaveBeenCalledWith(
        expect.objectContaining({ queryKey: ["issues", "p1", 7] }),
      );
    }
  });

  it("ignores malformed and schema-invalid frames", () => {
    const { sources, invalidateQueries } = setup();
    const emit = (type: string, data: unknown) => () => sources[0]?.emit(type, { data });
    expect(emit("stage_changed", "{not json")).not.toThrow();
    expect(emit("run_finished", JSON.stringify({ issueId: "7", runId: "r1" }))).not.toThrow();
    expect(
      emit("cost_updated", JSON.stringify({ issueId: 7, costUsd: "1", anyCostUnknown: false })),
    ).not.toThrow();
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("maps open and error readyState to connection states", () => {
    const { sources, states } = setup();
    const source = sources[0] as FakeSource;
    source.emit("open");
    source.readyState = 0;
    source.emit("error");
    source.readyState = 2;
    source.emit("error");
    expect(states).toEqual(["connected", "reconnecting", "offline"]);
  });

  it("closes the source and stops invalidating after unsubscribe", () => {
    const { sources, invalidateQueries, stop } = setup();
    stop();
    expect(sources[0]?.closed).toBe(1);
    sources[0]?.emit("run_finished", frame({ issueId: 7, runId: "r1" }));
    expect(invalidateQueries).not.toHaveBeenCalled();
  });

  it("opens no source without a project", () => {
    const createSource = vi.fn();
    const stop = subscribeLiveEvents({
      baseUrl: "",
      project: undefined,
      queryClient: { invalidateQueries: vi.fn() },
      onState: vi.fn(),
      createSource,
    });
    expect(createSource).not.toHaveBeenCalled();
    expect(() => stop()).not.toThrow();
  });
});

const sseResponse = (): Response =>
  new Response(new ReadableStream<Uint8Array>({ start: () => undefined }), { status: 200 });

function subscribe(extra: Record<string, unknown>, project: string | null = "p1") {
  const invalidateQueries = vi.fn();
  const states: ConnectionState[] = [];
  const stop = subscribeLiveEvents({
    baseUrl: "https://h1.example",
    project: project ?? undefined,
    queryClient: { invalidateQueries },
    onState: (s) => states.push(s),
    ...extra,
  });
  return { invalidateQueries, states, stop };
}

describe("live events with a token", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("with a token reads the stream via fetch and maps states", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(sseResponse())
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);
    const { states, stop } = subscribe({ token: "tok" });
    await vi.advanceTimersByTimeAsync(0);
    const first = fetchMock.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(first[0]).toBe("https://h1.example/events/stream?project=p1");
    expect(first[0]).not.toContain("tok");
    expect(first[1].headers["x-friday-token"]).toBe("tok");
    expect(states).toEqual(["connected"]);
    stop();

    const again = subscribe({ token: "tok" });
    await vi.advanceTimersByTimeAsync(0);
    expect(again.states).toEqual(["reconnecting"]);
    await vi.advanceTimersByTimeAsync(1000);
    expect(again.states).toEqual(["reconnecting", "offline"]);
    again.stop();

    const injected = vi.fn(() => new FakeSource("x"));
    const calls = fetchMock.mock.calls.length;
    subscribe({ token: "tok", createSource: injected }).stop();
    expect(injected).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.length).toBe(calls);
  });

  it("without a token keeps EventSource and opens nothing without a project", () => {
    const eventSource = vi.fn();
    class FakeEventSource extends FakeSource {
      constructor(url: string) {
        super(url);
        eventSource(url);
      }
    }
    const fetchMock = vi.fn();
    vi.stubGlobal("EventSource", FakeEventSource);
    vi.stubGlobal("fetch", fetchMock);
    for (const extra of [{}, { token: "" }]) {
      eventSource.mockClear();
      subscribeLiveEvents({
        baseUrl: "",
        project: "p1",
        queryClient: { invalidateQueries: vi.fn() },
        ...extra,
      });
      expect(eventSource).toHaveBeenCalledTimes(1);
      expect(eventSource).toHaveBeenCalledWith("/events/stream?project=p1");
    }
    expect(fetchMock).not.toHaveBeenCalled();
    eventSource.mockClear();
    for (const extra of [{}, { token: "tok" }]) {
      subscribe(extra, null).stop();
    }
    expect(eventSource).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("invalidates approvals and status of the host when host is set", () => {
    const frames: [string, unknown][] = [
      ["stage_changed", { issueId: 7, from: "ready", to: "in-progress", heldReason: null }],
      ["run_finished", { issueId: 7, runId: "r1" }],
      ["cost_updated", { issueId: 7, costUsd: 1.5, anyCostUnknown: false }],
    ];
    for (const withHost of [true, false]) {
      for (const [type, body] of frames) {
        const sources: FakeSource[] = [];
        const { invalidateQueries } = subscribe({
          ...(withHost ? { host: "h1" } : {}),
          createSource: (url: string) => {
            const s = new FakeSource(url);
            sources.push(s);
            return s;
          },
        });
        sources[0]?.emit(type, frame(body));
        const keys = invalidateQueries.mock.calls.map(
          (c) => (c[0] as { queryKey: unknown[] }).queryKey,
        );
        const expected: unknown[] = [["issues", "p1"], ["issues", "p1", 7]];
        if (withHost) expected.push(["approvals", "p1", "h1"], ["status", "p1", "h1"]);
        expect(keys).toEqual(expected);
        sources[0]?.emit(type, { data: "{bad" });
        expect(invalidateQueries).toHaveBeenCalledTimes(expected.length);
      }
    }
  });
});
