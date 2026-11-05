import { join } from "node:path";

/** Central registry folder (D47): `FRIDAY_HOME` when set, else `<home>/.friday/registry`. */
export function resolveRegistryRoot(input: {
  env: Record<string, string | undefined>;
  homeDir: string;
}): string {
  const fromEnv = input.env.FRIDAY_HOME;
  if (fromEnv !== undefined && fromEnv !== "") return fromEnv;
  return join(input.homeDir, ".friday", "registry");
}
