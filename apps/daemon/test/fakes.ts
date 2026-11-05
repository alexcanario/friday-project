import type {
  AgentRunRequest,
  AgentRuntime,
  EventStore,
  IssueRepository,
  IssueRow,
  NewEvent,
  StoredEvent,
} from "@friday/application";
import type { Clock, ReadyIssueSource } from "../src/index.ts";

export type RunResult = Awaited<ReturnType<AgentRuntime["run"]>>;

export class FakeClock implements Clock {
  #now = 0;
  readonly #timers: { ms: number; fn: () => void; next: number; active: boolean }[] = [];

  now(): number {
    return this.#now;
  }

  every(ms: number, fn: () => void): () => void {
    const timer = { ms, fn, next: this.#now + ms, active: true };
    this.#timers.push(timer);
    return () => {
      timer.active = false;
    };
  }

  advance(ms: number): void {
    const target = this.#now + ms;
    for (;;) {
      const due = this.#timers.filter((t) => t.active && t.next <= target);
      if (due.length === 0) break;
      const timer = due.reduce((a, b) => (a.next <= b.next ? a : b));
      this.#now = timer.next;
      timer.next += timer.ms;
      timer.fn();
    }
    this.#now = target;
  }
}

export class FakeEvents implements EventStore {
  readonly appended: NewEvent[] = [];

  append(event: NewEvent): StoredEvent {
    this.appended.push(event);
    return { ...event, seq: this.appended.length };
  }

  list(): StoredEvent[] {
    return [];
  }
}

export class FakeIssues implements ReadyIssueSource {
  calls = 0;
  ready: number[] = [];
  failure: Error | null = null;

  listReady(): Promise<number[]> {
    this.calls += 1;
    if (this.failure) return Promise.reject(this.failure);
    return Promise.resolve([...this.ready]);
  }
}

/** Every run stays pending until the test settles it. */
export class PendingRuntime implements AgentRuntime {
  readonly requests: AgentRunRequest[] = [];
  readonly #settlers: { resolve: (r: RunResult) => void; reject: (e: Error) => void }[] = [];

  run(request: AgentRunRequest): Promise<RunResult> {
    this.requests.push(request);
    return new Promise<RunResult>((resolve, reject) => {
      this.#settlers.push({ resolve, reject });
    });
  }

  resolveAll(result: RunResult): void {
    for (const s of this.#settlers.splice(0)) s.resolve(result);
  }

  rejectAll(error: Error): void {
    for (const s of this.#settlers.splice(0)) s.reject(error);
  }
}

export function fakeRequest(issueId: number): AgentRunRequest {
  return {
    cwd: `/work/${issueId}`,
    prompt: `issue ${issueId}`,
    configRoot: "/cfg",
    agent: {
      model: "haiku",
      maxBudgetUsd: 1,
      maxTurns: 1,
      timeoutMs: 1000,
      tools: [],
      allowedTools: [],
      bashAllow: [],
      promptFile: "p.md",
      outputKind: null,
    },
  } as unknown as AgentRunRequest;
}

export class FakeIssueRepository implements IssueRepository {
  row: IssueRow | null = null;
  readonly rebuilds: { projectId: string; appendedCount: number }[] = [];

  readonly #events: FakeEvents;

  constructor(events: FakeEvents) {
    this.#events = events;
  }

  get(): IssueRow | null {
    return this.row;
  }

  rebuild(projectId: string): void {
    this.rebuilds.push({ projectId, appendedCount: this.#events.appended.length });
  }
}
