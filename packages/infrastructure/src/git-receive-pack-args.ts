/**
 * A `file://` target runs `receive-pack` as a child that does not inherit the config of the
 * environment (git unsets `GIT_CONFIG_COUNT` for it), so it would read the config-defined hooks of the
 * global config and run `reference-transaction` while updating the target. Switch each one off there.
 */
export function receivePackArgs(git: string, targetUrl: string, hooks: string[]): string[] {
  if (hooks.length === 0 || !targetUrl.startsWith("file://")) return [];
  const quote = (text: string): string => `'${text.split("'").join(`'\\''`)}'`;
  const off = hooks.flatMap((name) => ["-c", quote(`hook.${name}.enabled=false`)]);
  return [`--receive-pack=${[quote(git), ...off, "receive-pack"].join(" ")}`];
}
