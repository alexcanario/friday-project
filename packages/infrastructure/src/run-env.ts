const ALLOWED = ["ANTHROPIC_API_KEY", "PATH", "HOME", "SystemRoot", "USERPROFILE", "TEMP"].map(
  (name) => name.toLowerCase(),
);

/** Fixed allow-list (R3): nothing else from the host environment reaches the agent. */
export function buildRunEnv(source: Record<string, string | undefined>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && ALLOWED.includes(key.toLowerCase())) env[key] = value;
  }
  return env;
}
