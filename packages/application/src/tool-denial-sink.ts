/** `reason` and `target` are optional and may hold secrets until the recorder redacts them (D116). */
export type ToolDenied = {
  toolName: string;
  toolUseId: string;
  reason?: string;
  target?: string;
};

/** Receives every tool call the permission policy denied during a run. */
export interface ToolDenialSink {
  record(denial: ToolDenied): void;
}
