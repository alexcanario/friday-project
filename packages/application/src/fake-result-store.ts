import type { ContractKind } from "@friday/contracts";
import type { ResultStore, RunLookup } from "./result-gate.ts";

export class FakeResultStore implements ResultStore {
  readonly records: Array<{ runId: string; kind: ContractKind; value: unknown }> = [];

  has(runId: string, kind: ContractKind): boolean {
    return this.records.some((r) => r.runId === runId && r.kind === kind);
  }

  record(runId: string, kind: ContractKind, value: unknown): void {
    this.records.push({ runId, kind, value });
  }
}

export class FakeRunLookup implements RunLookup {
  readonly #active: Set<string>;

  constructor(activeRunIds: string[]) {
    this.#active = new Set(activeRunIds);
  }

  isActive(runId: string): boolean {
    return this.#active.has(runId);
  }
}
