import { describe, expect, it } from "vitest";
import { type QaCompose, type QaReadPort } from "../src/index.ts";
import { contextFor, runQa } from "./compose-qa-helpers.ts";

/** Never executed: only compiled, so the `@ts-expect-error` lines are checked by tsc. */
export function typeChecks(read: QaReadPort): void {
  // @ts-expect-error append não existe na porta de leitura
  read.events.append({
    projectId: "p",
    issueId: 7,
    runId: null,
    type: "X",
    payload: {},
    actor: "daemon",
    at: "",
  });
  // @ts-expect-error rebuild não existe na porta de leitura
  read.issues.rebuild("p");
}

type Seen = {
  hasAppend: boolean;
  listType: string;
  types: string[];
  hasRebuild: boolean;
  state: string | undefined;
  appendValue: unknown;
  before: number;
  after: number;
};

async function capture(): Promise<Seen> {
  let seen: Seen | undefined;
  const context: QaCompose["context"] = (id, runId, read) => {
    const before = read.events.list("p", 7).length;
    seen = {
      hasAppend: "append" in read.events,
      listType: typeof read.events.list,
      types: read.events.list("p", 7).map((e) => e.type),
      hasRebuild: "rebuild" in read.issues,
      state: read.issues.get("p", 7)?.state,
      appendValue: (read.events as unknown as { append?: unknown }).append,
      before,
      after: 0,
    };
    const result = contextFor(id, runId, read);
    seen.after = read.events.list("p", 7).length;
    return result;
  };
  await runQa({ context });
  return seen!;
}

describe("QA read port", () => {
  it("rejects append on the read port events (type)", () => {
    expect(typeChecks).toBeTypeOf("function");
  });

  it("rejects rebuild on the read port issues (type)", () => {
    expect(typeChecks).toBeTypeOf("function");
  });

  it("gives qa.context an events port with list only", async () => {
    const seen = await capture();
    expect(seen.hasAppend).toBe(false);
    expect(seen.listType).toBe("function");
    expect(seen.types).toContain("WorkReported");
  });

  it("gives qa.context an issues port with get only", async () => {
    const seen = await capture();
    expect(seen.hasRebuild).toBe(false);
    expect(seen.state).toBe("QA");
  });

  it("does not let qa.context write events", async () => {
    const seen = await capture();
    expect(seen.appendValue).toBeUndefined();
    expect(seen.after).toBe(seen.before);
  });
});
