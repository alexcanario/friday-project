import type { BreakerState, BreakerStateRepository } from "@friday/application";

export type BreakerOptions = {
  now: () => Date;
  threshold: number;
  windowMs: number;
  openMs: number;
  persist?: { store: BreakerStateRepository; projectId: string };
};

export type Breaker = { recordFailure(): void; isOpen(): boolean };

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function isIso(value: unknown): value is string {
  return typeof value === "string" && ISO.test(value) && !Number.isNaN(Date.parse(value));
}

function assertValidState(state: BreakerState): void {
  const valid =
    (state.openedAt === null || isIso(state.openedAt)) &&
    Array.isArray(state.failures) &&
    state.failures.every(isIso);
  if (!valid) throw new Error("Persisted breaker state has an invalid timestamp.");
}

/** Opens after `threshold` runtime failures within `windowMs`, for `openMs`; state survives a restart through `persist`. */
export function createBreaker(options: BreakerOptions): Breaker {
  const { persist } = options;
  const initial: BreakerState = persist?.store.get(persist.projectId) ?? {
    openedAt: null,
    failures: [],
  };
  assertValidState(initial);
  let openedAt: number | null = initial.openedAt === null ? null : Date.parse(initial.openedAt);
  let failures: number[] = initial.failures.map((f) => Date.parse(f));

  function save(): void {
    persist?.store.save(persist.projectId, {
      openedAt: openedAt === null ? null : new Date(openedAt).toISOString(),
      failures: failures.map((f) => new Date(f).toISOString()),
    });
  }

  /** Closes an expired opening; the in-memory state only changes once the save succeeds. */
  function refresh(now: number): void {
    if (openedAt === null || now - openedAt < options.openMs) return;
    const previous = { openedAt, failures };
    openedAt = null;
    failures = [];
    try {
      save();
    } catch (error) {
      openedAt = previous.openedAt;
      failures = previous.failures;
      throw error;
    }
  }

  return {
    isOpen() {
      refresh(options.now().getTime());
      return openedAt !== null;
    },
    recordFailure() {
      const now = options.now().getTime();
      refresh(now);
      if (openedAt !== null) return;
      failures = [...failures.filter((f) => now - f <= options.windowMs), now];
      if (failures.length >= options.threshold) {
        openedAt = now;
        failures = [];
      }
      save();
    },
  };
}
