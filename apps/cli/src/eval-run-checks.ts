import { statSync } from "node:fs";
import { isAbsolute } from "node:path";
import {
  toAgentRunOptions,
  type AgentRunOptions,
  type ReviewCredential,
} from "@friday/application";
import { assertQaAgentConfig, assertSpecialistAgentConfig } from "@friday/daemon";
import { loadFactoryConfig } from "@friday/infrastructure";
import { daemonPaths } from "./daemon-values.ts";

type Env = Record<string, string | undefined>;
type Loaded = Extract<ReturnType<typeof loadFactoryConfig>, { ok: true }>;

export const SANDBOX_REPOSITORY = "friday-sandbox";
export const SPECIALIST_ROLES = ["generic", "backend", "frontend"] as const;
const REQUIRED_CARDS = [...SPECIALIST_ROLES, "qa", "judge", "judge-strong"] as const;

type SpecialistRole = (typeof SPECIALIST_ROLES)[number];
type Card = (typeof REQUIRED_CARDS)[number];

export type CheckInput = { registryRoot: string; env: Env; homeDir: string };

export type CheckedProduction = {
  config: Loaded["config"];
  paths: { root: string; repoDir: string };
  roles: Record<SpecialistRole, AgentRunOptions>;
  qa: AgentRunOptions;
  judges: Record<"judge" | "judge-strong", AgentRunOptions>;
  authorTokenEnv: string;
  authorToken: string;
  review: ReviewCredential;
};

const filled = (value: string | undefined): value is string =>
  value !== undefined && value.trim() !== "";

function readToken(env: Env, name: string): string {
  const value = env[name];
  if (!filled(value)) throw new Error(`A variável ${name} está vazia ou ausente.`);
  return value;
}

/** (0) and (1): an absolute FRIDAY_HOME, when set, and a valid factory.yaml. */
function loadConfig(input: CheckInput): Loaded {
  const home = input.env.FRIDAY_HOME;
  if (home !== undefined && home !== "" && (home !== home.trim() || !isAbsolute(home))) {
    throw new Error("A variável FRIDAY_HOME deve ser um caminho absoluto.");
  }
  const loaded = loadFactoryConfig(input.registryRoot);
  if (!loaded.ok) throw new Error("O factory.yaml está inválido ou ausente.");
  return loaded;
}

/** (2) and (3): the sandbox repository lock and the six cards of the central registry. */
function cardsOf(loaded: Loaded): Record<Card, AgentRunOptions> {
  const { owner, name } = loaded.config.repository;
  if (name !== SANDBOX_REPOSITORY) {
    throw new Error(
      `Erro: o experimento só roda no repositório ${SANDBOX_REPOSITORY} (configurado: ${owner}/${name})`,
    );
  }
  const cards = {} as Record<Card, AgentRunOptions>;
  for (const role of REQUIRED_CARDS) {
    const card = loaded.agents[role];
    if (card === undefined) throw new Error(`A ficha ${role} não está no registro central.`);
    cards[role] = toAgentRunOptions(card);
  }
  return cards;
}

/** (4): only the fixed author token is supported; the App mode stays out of the experiment. */
function authorTokenEnvOf(loaded: Loaded): string {
  const { author_app: app, author_token_env: tokenEnv } = loaded.config.pull_requests;
  if (app !== undefined || tokenEnv === undefined) {
    throw new Error("O experimento só suporta pull_requests.author_token_env.");
  }
  return tokenEnv;
}

/** (5): the clone of the sandbox repository must already exist (the owner creates it, #534). */
function pathsOf(input: CheckInput, loaded: Loaded): CheckedProduction["paths"] {
  const { root, repoDir } = daemonPaths({
    env: input.env,
    homeDir: input.homeDir,
    repository: loaded.config.repository,
  });
  if (statSync(repoDir, { throwIfNoEntry: false })?.isDirectory() !== true) {
    throw new Error(`Erro: o clone do repositório não existe: ${repoDir}`);
  }
  return { root, repoDir };
}

/** (8): the same card checks as the daemon (compose.ts), with their messages. */
function assertCards(cards: Record<Card, AgentRunOptions>): void {
  for (const role of SPECIALIST_ROLES) assertSpecialistAgentConfig(cards[role]);
  assertQaAgentConfig(cards.qa);
}

/** (7): the Judge credential; in the env mode its variable must be set. */
function reviewOf(
  input: CheckInput,
  readReview: (root: string) => ReviewCredential | null,
): ReviewCredential {
  const review = readReview(input.registryRoot);
  if (review === null) throw new Error("O token de revisão não está configurado no factory.yaml.");
  if (review.mode === "env") readToken(input.env, review.tokenEnv);
  return review;
}

/**
 * The safety checks of the experiment, in order, before any token, database or adapter:
 * (0) FRIDAY_HOME, (1) factory.yaml, (2) repository lock, (3) cards, (4) author mode, (5) clone,
 * (8) card checks, (6) author token, (7) review credential. Only (6) and (7) read a token.
 */
export function checkProduction(
  input: CheckInput,
  readReview: (root: string) => ReviewCredential | null,
): CheckedProduction {
  const loaded = loadConfig(input);
  const cards = cardsOf(loaded);
  const authorTokenEnv = authorTokenEnvOf(loaded);
  const paths = pathsOf(input, loaded);
  assertCards(cards);
  const authorToken = readToken(input.env, authorTokenEnv);
  const review = reviewOf(input, readReview);
  return {
    config: loaded.config,
    paths,
    roles: { generic: cards.generic, backend: cards.backend, frontend: cards.frontend },
    qa: cards.qa,
    judges: { judge: cards.judge, "judge-strong": cards["judge-strong"] },
    authorTokenEnv,
    authorToken,
    review,
  };
}
