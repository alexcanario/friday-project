import { join } from "node:path";
import type { GitHubPort } from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createGitHubClient,
  createIssueRepository,
  createUnitOfWork,
  GitHubRestAdapter,
  loadFactoryConfig,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import type { ApprovalsClient } from "./approvals.ts";
import { createDirectClient } from "./direct-client.ts";

type Env = Record<string, string | undefined>;
type Repo = { owner: string; repo: string };
type GitHubDeps = Pick<GitHubPort, "squashMerge" | "getPrMergeState">;

export type ProductionOptions = {
  env: Env;
  homeDir: string;
  createGitHub?: (token: string, repo: Repo) => GitHubDeps;
};

const DEFAULT_TOKEN_ENV = "FRIDAY_AUTHOR_TOKEN";

export function resolveConfigRoot(input: { env: Env; homeDir: string }): string {
  const home = input.env.FRIDAY_HOME;
  return home !== undefined && home !== "" ? home : join(input.homeDir, ".friday");
}

/** Reads the author token by variable name only; fails closed before touching anything. */
function readAuthor(opts: ProductionOptions): { token: string; repo: Repo } {
  const loaded = loadFactoryConfig(resolveConfigRoot(opts));
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const name = loaded.config.pull_requests.author_token_env ?? DEFAULT_TOKEN_ENV;
  const token = opts.env[name];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${name} está vazia ou ausente.`);
  const { owner, name: repo } = loaded.config.repository;
  return { token, repo: { owner, repo } };
}

const defaultGitHub = (token: string, repo: Repo): GitHubDeps =>
  new GitHubRestAdapter(createGitHubClient(token), repo);

export function createProductionOpen(opts: ProductionOptions): (dbPath: string) => ApprovalsClient {
  return (dbPath) => {
    let db: FridayDatabase | undefined;
    let direct: ApprovalsClient | undefined;
    let github: GitHubDeps | null = null;

    function requireGitHub(): GitHubDeps {
      if (github === null) throw new Error("O GitHub não foi configurado.");
      return github;
    }

    function openDirect(): ApprovalsClient {
      const opened = openDatabase(dbPath);
      db = opened;
      return createDirectClient({
        store: createApprovalStore(opened),
        events: createEventStore(opened),
        unitOfWork: createUnitOfWork(opened),
        issues: createIssueRepository(opened),
        github: {
          squashMerge: (pr, sha) => requireGitHub().squashMerge(pr, sha),
        },
        readPrHead: async (pr) => (await requireGitHub().getPrMergeState(pr)).headSha,
        now: () => Date.now(),
      });
    }

    return {
      async list(project) {
        direct ??= openDirect();
        return direct.list(project);
      },
      async decide(id, decision) {
        if (github === null) {
          const { token, repo } = readAuthor(opts);
          github = (opts.createGitHub ?? defaultGitHub)(token, repo);
        }
        direct ??= openDirect();
        return direct.decide(id, decision);
      },
      close() {
        db?.close();
      },
    };
  };
}
