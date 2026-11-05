import type { ToolDenialSink } from "@friday/application";

/** Forwards each toolUseId once per run; the same call can reach us by hook, canUseTool and result. */
export function dedupeDenials(sink: ToolDenialSink): ToolDenialSink {
  const seen = new Set<string>();
  return {
    record(denial) {
      if (seen.has(denial.toolUseId)) return;
      sink.record(denial);
      seen.add(denial.toolUseId);
    },
  };
}
