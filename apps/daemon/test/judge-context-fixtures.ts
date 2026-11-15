import type { StoredEvent } from "@friday/application";

export const A = "a".repeat(40);
export const B = "b".repeat(40);
export const identity = (text: string) => text;

export type Spec = { type: string; payload: unknown; runId?: string | null };
export const log = (...specs: Spec[]): StoredEvent[] =>
  specs.map((s, i) => ({
    seq: i + 1,
    projectId: "p",
    issueId: 7,
    runId: s.runId ?? null,
    type: s.type,
    payload: s.payload,
    actor: "daemon",
    at: "2026-11-12T03:00:00.000Z",
  }));

export const criteria = (claims: string[] = ["a", "b"]): Spec => ({
  type: "CriteriaSet",
  payload: {
    criteria: claims.map((claim, i) => ({
      index: i + 1,
      claim,
      proof:
        i === 1 ? { kind: "browser", step: "abrir /" } : { kind: "command", command: "pnpm test" },
    })),
  },
});
export const work = (head: string): Spec => ({
  type: "WorkReported",
  payload: { worktreePath: "/tmp/wt", headSha: head, changedFiles: [] },
});
export const qa = (n: number, how = "ok", notChecked: string[] = [], output?: unknown): Spec[] => [
  {
    type: "RunFinished",
    runId: `qa-${n}`,
    payload: {
      status: "succeeded",
      output: output ?? {
        verdict: "pass",
        criteria: [{ index: 1, result: "pass", how, screenshots: [] }],
        notChecked,
      },
    },
  },
  {
    type: "StateChanged",
    runId: `qa-${n}`,
    payload: { trigger: "QaPassed", to: "InReview" },
  },
];

export const lines = (out: string) => out.split(/\r\n|\n|\r/);
export const bloco = (out: string, kind: string): string => {
  const m = new RegExp(`<untrusted_data kind="${kind}">\\n([\\s\\S]*?)\\n</untrusted_data>`).exec(
    out,
  );
  return m?.[1] ?? "";
};
