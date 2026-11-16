const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
};

function searchTarget(input: Record<string, unknown>): string | undefined {
  const pattern = stringField(input, "pattern");
  if (pattern === undefined) return undefined;
  const path = stringField(input, "path");
  return path === undefined ? `pattern=${pattern}` : `pattern=${pattern} path=${path}`;
}

/** What the agent asked for in a denied call, for the event log; undefined when there is none. */
export function denialTargetOf(toolName: string, toolInput: unknown): string | undefined {
  if (!isRecord(toolInput)) return undefined;
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
      return stringField(toolInput, "file_path");
    case "Grep":
    case "Glob":
      return searchTarget(toolInput);
    case "Bash":
      return stringField(toolInput, "command");
    default:
      return undefined;
  }
}
