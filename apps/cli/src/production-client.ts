import { join } from "node:path";
import type { GitHubPort } from "@friday/application";
import {
  createApprovalStore,
  createEventStore,
  createGitHubClient,
  createGitHubClientWithAuth,
  createInstallationTokenProvider,
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
  createTokenProvider?: (input: AppInput) => { getToken(): Promise<string> };
  createGitHubWithAuth?: (auth: () => Promise<string>, repo: Repo) => GitHubDeps;
};

type AppInput = { appId: number; installationId: number; privateKeyPath: string };
type Author =
  { mode: "env"; token: string; repo: Repo } | { mode: "app"; app: AppInput; repo: Repo };

export function resolveConfigRoot(input: { env: Env; homeDir: string }): string {
  const home = input.env.FRIDAY_HOME;
  return home !== undefined && home !== "" ? home : join(input.homeDir, ".friday");
}

/** Reads the author credential (variable name or App); fails closed before touching anything. */
function readAuthor(opts: ProductionOptions): Author {
  const loaded = loadFactoryConfig(resolveConfigRoot(opts));
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  const { owner, name } = loaded.config.repository;
  const repo = { owner, repo: name };
  const pr = loaded.config.pull_requests;
  if (pr.author_app !== undefined) {
    const { app_id, installation_id, private_key_path } = pr.author_app;
    const app = {
      appId: app_id,
      installationId: installation_id,
      privateKeyPath: private_key_path,
    };
    return { mode: "app", app, repo };
  }
  const envName = pr.author_token_env;
  if (envName === undefined)
    throw new Error("A configuração não define pull_requests.author_token_env.");
  const token = opts.env[envName];
  if (token === undefined || token.trim() === "")
    throw new Error(`A variável ${envName} está vazia ou ausente.`);
  return { mode: "env", token, repo };
}

const defaultGitHub = (token: string, repo: Repo): GitHubDeps =>
  new GitHubRestAdapter(createGitHubClient(token), repo);

const defaultGitHubWithAuth = (auth: () => Promise<string>, repo: Repo): GitHubDeps =>
  new GitHubRestAdapter(createGitHubClientWithAuth(auth), repo);

const defaultTokenProvider = (input: AppInput) =>
  createInstallationTokenProvider({ ...input, now: Date.now, fetch: globalThis.fetch });

function buildGitHub(opts: ProductionOptions): GitHubDeps {
  const author = readAuthor(opts);
  if (author.mode === "env") return (opts.createGitHub ?? defaultGitHub)(author.token, author.repo);
  const provider = (opts.createTokenProvider ?? defaultTokenProvider)(author.app);
  const create = opts.createGitHubWithAuth ?? defaultGitHubWithAuth;
  return create(() => provider.getToken(), author.repo);
}

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
        github ??= buildGitHub(opts);
        direct ??= openDirect();
        return direct.decide(id, decision);
      },
      close() {
        db?.close();
      },
    };
  };
}
