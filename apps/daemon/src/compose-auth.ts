import type { GitHubPort } from "@friday/application";
import {
  GitHubRestAdapter,
  createGitHubClient,
  createGitHubClientWithAuth,
  createInstallationTokenProvider,
} from "@friday/infrastructure";
import type { Repo } from "./compose-branches.ts";
import type { Author } from "./compose-config.ts";
import type { ComposeOptions } from "./compose.ts";

export const defaultGitHub = (token: string, repo: Repo): GitHubPort =>
  new GitHubRestAdapter(createGitHubClient(token), repo);

const defaultGitHubWithAuth = (auth: () => Promise<string>, repo: Repo): GitHubPort =>
  new GitHubRestAdapter(createGitHubClientWithAuth(auth), repo);

export type GitAuth = { tokenEnv: string } | { token: () => Promise<string> };

export interface AuthWiring {
  /** Options of the `GitCliHost` that carry the author credential (token or variable name, never both). */
  git: GitAuth;
  /** The author's GitHub port: a fixed token (`author_token_env`) or a provider asked per request (`author_app`). */
  github(): GitHubPort;
}

/** Picks between the fixed token and the installation-token provider (D89, D90). */
export function authWiringOf(opts: ComposeOptions, author: Author): AuthWiring {
  if (author.mode === "env") {
    const create = opts.createGitHub ?? defaultGitHub;
    return {
      git: { tokenEnv: author.tokenEnv },
      github: () => create(author.token, author.repo),
    };
  }
  const createProvider =
    opts.createTokenProvider ??
    ((input) =>
      createInstallationTokenProvider({ ...input, now: Date.now, fetch: globalThis.fetch }));
  const provider = createProvider(author.app);
  const auth = () => provider.getToken();
  const create = opts.createGitHubWithAuth ?? defaultGitHubWithAuth;
  return { git: { token: auth }, github: () => create(auth, author.repo) };
}
