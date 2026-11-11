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

/** Production values of the Judge input (D73, D76); the config root is the central one, never a worktree (R4). */
export function judgeInputOf(input: {
  root: string;
  repository: Repository;
  issueId: number;
  headSha: string;
}): {
  cwd: string;
  prompt: string;
  configRoot: string;
} {
  const { root, repository, issueId, headSha } = input;
  if (!Number.isInteger(issueId) || issueId <= 0) {
    throw new Error(`O número da issue deve ser um inteiro positivo: ${issueId}.`);
  }
  if (!/^[0-9a-f]{40}$/.test(headSha)) {
    throw new Error(`O head SHA deve ter 40 caracteres hexadecimais minúsculos: ${headSha}.`);
  }
  return {
    cwd: join(root, "worktrees", `${repository.owner}__${repository.name}`, String(issueId)),
    prompt: `Review the pull request of issue #${issueId}. The head SHA of the pull request is ${headSha}. Read the diff with pr_diff and finish by calling review_verdict once, with that value in headSha.`,
    configRoot: root,
  };
}
