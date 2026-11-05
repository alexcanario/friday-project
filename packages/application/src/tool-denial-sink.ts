export type ToolDenied = { toolName: string; toolUseId: string };

/** Receives every tool call the permission policy denied during a run. */
export interface ToolDenialSink {
  record(denial: ToolDenied): void;
}
