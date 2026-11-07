import type {
  AgentRunRequest,
  AgentRuntime,
  ApprovalRecord,
  ApprovalStore,
  EventStore,
  IssueRepository,
  IssueRow,
  IssueSummary,
  NewEvent,
  PrDiff,
  RunRecord,
  RunRepository,
  StateChangedPayload,
  StoredEvent,
  StaleVerdicts,
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
  /** Throws the returned error instead of storing the event. */
  failWhen: ((event: NewEvent) => Error | null) | null = null;

  readonly #order: string[] | undefined;

  constructor(order?: string[]) {
    this.#order = order;
  }

  append(event: NewEvent): StoredEvent {
    const failure = this.failWhen?.(event) ?? null;
    if (failure) throw failure;
    this.#order?.push("events.append");
    this.appended.push(event);
    return { ...event, seq: this.appended.length };
  }

  list(projectId?: string, issueId?: number): StoredEvent[] {
    return this.appended.flatMap((event, index) =>
      (projectId === undefined || event.projectId === projectId) &&
      (issueId === undefined || event.issueId === issueId)
        ? [{ ...event, seq: index + 1 }]
        : [],
    );
  }
}

export class FakeStaleVerdicts implements StaleVerdicts {
  readonly #marked = new Set<string>();

  markStale(projectId: string, issueId: number, headSha: string): void {
    this.#marked.add(`${projectId}:${issueId}:${headSha}`);
  }

  isStale(projectId: string, issueId: number, headSha: string): boolean {
    return this.#marked.has(`${projectId}:${issueId}:${headSha}`);
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
  readonly #order: string[] | undefined;

  constructor(order?: string[]) {
    this.#order = order;
  }

  run(request: AgentRunRequest): Promise<RunResult> {
    this.#order?.push("runtime.run");
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
  /** Per-issue rows; when non-empty they take precedence over `row`. */
  readonly rows = new Map<number, IssueRow>();
  readonly getCalls: number[] = [];
  getFailure: Error | null = null;
  readonly rebuilds: { projectId: string; appendedCount: number }[] = [];

  readonly #events: FakeEvents;
  readonly #order: string[] | undefined;

  readonly #projectFromEvents: boolean;

  constructor(events: FakeEvents, order?: string[], options: { projectFromEvents?: boolean } = {}) {
    this.#events = events;
    this.#order = order;
    this.#projectFromEvents = options.projectFromEvents ?? false;
  }

  get(_projectId?: string, issueId?: number): IssueRow | null {
    if (issueId !== undefined) this.getCalls.push(issueId);
    if (this.getFailure) throw this.getFailure;
    if (this.rows.size > 0) return issueId === undefined ? null : (this.rows.get(issueId) ?? null);
    return this.row;
  }

  list(): IssueRow[] {
    return this.row ? [this.row] : [];
  }

  rebuild(projectId: string): void {
    this.#order?.push("rebuild");
    this.rebuilds.push({ projectId, appendedCount: this.#events.appended.length });
    if (!this.#projectFromEvents) return;
    for (const event of this.#events.appended) {
      if (event.type !== "StateChanged" || event.issueId === null) continue;
      const payload = event.payload as StateChangedPayload;
      this.rows.set(event.issueId, {
        projectId: event.projectId,
        issueId: event.issueId,
        state: payload.to,
        heldReason: payload.heldReason,
        verifyRound: payload.verifyRound,
        qaRound: payload.qaRound,
        reviewIter: payload.reviewIter,
      });
    }
  }
}

export class FakeGitHub {
  readonly issues: IssueSummary[] = [];
  readonly diffs = new Map<number, PrDiff>();
  readonly listCalls: string[] = [];
  readonly labelCalls: { issue: number; label: string }[] = [];
  addLabelFailure: Error | null = null;

  readonly #order: string[] | undefined;

  constructor(order?: string[]) {
    this.#order = order;
  }

  listIssuesByLabel(label: string): Promise<IssueSummary[]> {
    this.listCalls.push(label);
    return Promise.resolve(this.issues.filter((i) => i.labels.includes(label)));
  }

  getPrDiff(pr: number): Promise<PrDiff> {
    const diff = this.diffs.get(pr);
    return diff ? Promise.resolve(diff) : Promise.reject(new Error(`sem diff para o PR ${pr}`));
  }

  addLabel(issue: number, label: string): Promise<void> {
    this.#order?.push("addLabel");
    this.labelCalls.push({ issue, label });
    return this.addLabelFailure ? Promise.reject(this.addLabelFailure) : Promise.resolve();
  }
}

export class FakeRunRepository implements RunRepository {
  readonly rows = new Map<string, RunRecord>();
  calls = 0;
  saveFailure: Error | null = null;
  /** Fails only saves whose row matches. */
  saveFailWhen: ((run: RunRecord) => Error | null) | null = null;

  readonly #order: string[] | undefined;

  constructor(order?: string[]) {
    this.#order = order;
  }

  save(run: RunRecord): void {
    this.calls += 1;
    const failure = this.saveFailure ?? this.saveFailWhen?.(run) ?? null;
    if (failure) throw failure;
    this.#order?.push("runs.save");
    this.rows.set(run.id, { ...run });
  }

  get(runId: string): RunRecord | null {
    this.calls += 1;
    return this.rows.get(runId) ?? null;
  }

  list(projectId: string): RunRecord[] {
    return [...this.rows.values()].filter((r) => r.projectId === projectId);
  }

  listActive(projectId: string): RunRecord[] {
    return this.list(projectId).filter((r) => r.status === "running" && r.finishedAt === null);
  }
}

export class FakeApprovalStore implements ApprovalStore {
  readonly records = new Map<string, ApprovalRecord>();

  /** Test helper: stores a record as is. */
  seed(record: ApprovalRecord): void {
    this.records.set(record.id, { ...record });
  }

  insert(record: ApprovalRecord): void {
    if (this.records.has(record.id)) throw new Error(`pedido ${record.id} já existe`);
    this.records.set(record.id, { ...record });
  }

  get(id: string): ApprovalRecord | null {
    const found = this.records.get(id);
    return found ? { ...found } : null;
  }

  listPending(projectId: string, now: number): ApprovalRecord[] {
    return [...this.records.values()]
      .filter((r) => r.projectId === projectId && r.decision === null && r.expiresAt > now)
      .sort((a, b) => a.requestedAt - b.requestedAt || a.id.localeCompare(b.id));
  }

  latestForIssue(projectId: string, issueId: number): ApprovalRecord | null {
    const mine = [...this.records.values()]
      .filter((r) => r.projectId === projectId && r.issueId === issueId)
      .sort((a, b) => b.requestedAt - a.requestedAt || b.id.localeCompare(a.id));
    return mine[0] ? { ...mine[0] } : null;
  }

  decide(
    id: string,
    decision: { decision: "approved" | "denied"; decidedAt: number; decidedBy: string },
  ): boolean {
    const found = this.records.get(id);
    if (!found || found.decision !== null) return false;
    this.records.set(id, { ...found, ...decision });
    return true;
  }
}
