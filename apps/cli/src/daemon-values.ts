import { join } from "node:path";
import { resolveConfigRoot } from "./production-client.ts";

type Repository = { owner: string; name: string };

/** Central paths of the daemon (D71); the root never comes from a worktree (R4). */
export function daemonPaths(input: {
  env: Record<string, string | undefined>;
  homeDir: string;
  repository: Repository;
}): { root: string; dbPath: string; repoDir: string } {
  const root = resolveConfigRoot({ env: input.env, homeDir: input.homeDir });
  const { owner, name } = input.repository;
  return {
    root,
    dbPath: join(root, "friday.db"),
    repoDir: join(root, "repos", `${owner}__${name}`),
  };
}

export function projectIdOf(repository: Repository): string {
  return `${repository.owner}/${repository.name}`;
}
