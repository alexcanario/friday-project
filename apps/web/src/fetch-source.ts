import type { LiveSource } from "./live-events.ts";

type Listener = (event: { data?: unknown }) => void;

export interface FetchSourceOptions {
  fetchImpl?: typeof fetch;
  retryMs?: number;
}

interface Frame {
  id: string | null;
  event: string;
  data: string;
}

/** The server only sends numeric ids; anything else would make `fetch` reject the header. */
const NUMERIC_ID = /^\d+$/;

/** Longest text kept while waiting for a newline; a longer one is not a real stream. */
const MAX_PENDING = 1_048_576;

/** A header value `fetch` accepts without a rewrite: visible ASCII only. */
const HEADER_SAFE_TOKEN = /^[\x21-\x7E]+$/;

/**
 * Decodes SSE text into frames; a frame may be split anywhere between pushed chunks.
 * The returned function gives false when the unfinished line grew past `MAX_PENDING`.
 */
function createFrameDecoder(onFrame: (frame: Frame) => void): (text: string) => boolean {
  let pending = "";
  let id: string | null = null;
  let event = "message";
  let data: string[] = [];
  const dispatch = (): void => {
    if (data.length > 0) onFrame({ id, event, data: data.join("\n") });
    id = null;
    event = "message";
    data = [];
  };
  const field = (line: string): void => {
    if (line.startsWith(":")) return;
    const colon = line.indexOf(":");
    const name = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? "" : line.slice(colon + 1);
    const value = raw.startsWith(" ") ? raw.slice(1) : raw;
    if (name === "id") id = value;
    else if (name === "event") event = value === "" ? "message" : value;
    else if (name === "data") data.push(value);
  };
  return (text) => {
    pending += text;
    let newline = pending.indexOf("\n");
    while (newline !== -1) {
      const line = pending.slice(0, newline).replace(/\r$/, "");
      pending = pending.slice(newline + 1);
      if (line === "") dispatch();
      else field(line);
      newline = pending.indexOf("\n");
    }
    return pending.length <= MAX_PENDING;
  };
}

/**
 * A `LiveSource` over `fetch`, so the panel token can travel in the `x-friday-token` header
 * (an `EventSource` cannot send headers). The token never goes in the URL, a log or an event,
 * and redirects are never followed: the token must not leave for another destination.
 */
class FetchSource implements LiveSource {
  readyState = 0;
  private closed = false;
  private lastId: string | null = null;
  private controller: AbortController | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Map<string, Listener[]>();

  private readonly url: string;
  private readonly token: string;
  private readonly options: FetchSourceOptions | undefined;

  constructor(url: string, token: string, options: FetchSourceOptions | undefined) {
    this.url = url;
    this.token = token;
    this.options = options;
    if (HEADER_SAFE_TOKEN.test(token) || token === "") {
      void this.connect();
      return;
    }
    // A token `fetch` would reject (or rewrite) never leaves; the error reaches listeners added after this constructor.
    this.readyState = 2;
    queueMicrotask(() => {
      this.emit("error");
      this.closed = true;
    });
  }

  addEventListener(type: string, listener: Listener): void {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }

  close(): void {
    this.closed = true;
    this.readyState = 2;
    clearTimeout(this.timer);
    this.controller?.abort();
    void this.reader?.cancel().catch(() => undefined);
  }

  private emit(type: string, data?: string): void {
    if (this.closed) return;
    for (const listener of this.listeners.get(type) ?? []) {
      listener(data === undefined ? {} : { data });
    }
  }

  private fail(retry: boolean): void {
    if (this.closed) return;
    this.readyState = retry ? 0 : 2;
    this.emit("error");
    if (retry) this.timer = setTimeout(() => void this.connect(), this.options?.retryMs ?? 1000);
  }

  /** Reads one connection to its end; false when it was stopped for good (buffer overflow). */
  private async readBody(body: ReadableStream<Uint8Array>): Promise<boolean> {
    const text = new TextDecoder();
    const decode = createFrameDecoder((frame) => {
      if (frame.id !== null && NUMERIC_ID.test(frame.id)) this.lastId = frame.id;
      this.emit(frame.event, frame.data);
    });
    const reader = body.getReader();
    this.reader = reader;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return true;
      if (decode(text.decode(value, { stream: true }))) continue;
      void reader.cancel().catch(() => undefined);
      this.readyState = 2;
      this.emit("error");
      this.closed = true;
      return false;
    }
  }

  private async connect(): Promise<void> {
    const controller = new AbortController();
    this.controller = controller;
    const headers: Record<string, string> = { "x-friday-token": this.token };
    if (this.lastId !== null) headers["last-event-id"] = this.lastId;
    try {
      const fetchImpl = this.options?.fetchImpl ?? globalThis.fetch;
      const res = await fetchImpl(this.url, {
        headers,
        signal: controller.signal,
        redirect: "manual",
      });
      if (this.closed) return;
      if (res.status !== 200) return this.fail(res.status >= 500);
      if (res.body === null) return this.fail(true);
      this.readyState = 1;
      this.emit("open");
      if (!(await this.readBody(res.body))) return;
    } catch {
      if (this.closed) return;
    }
    this.fail(true);
  }
}

export function createFetchSource(
  url: string,
  token: string,
  options?: FetchSourceOptions,
): LiveSource {
  return new FetchSource(url, token, options);
}
