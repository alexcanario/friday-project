const ALLOWED_KEYS = ["ANTHROPIC_API_KEY", "PATH"];

export function buildEnv(
  source: Record<string, string | undefined>,
  extraKeys: string[] = [],
): Record<string, string> {
  const allowed = new Set([...ALLOWED_KEYS, ...extraKeys]);
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (allowed.has(key) && value !== undefined) env[key] = value;
  }
  return env;
}
