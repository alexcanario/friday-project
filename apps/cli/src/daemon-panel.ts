import type { ApiDeps, RunningApi, startApi } from "@friday/api";
import type { Daemon } from "@friday/daemon";
import {
  createApprovalStore,
  createBreakerStateRepository,
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createProjectEnabledRepository,
  createProjectListReader,
  createRunLedgerReader,
  createRunRepository,
  createUnitOfWork,
} from "@friday/infrastructure";
import { panelRefusalOf } from "./panel-checks.ts";

/** Default panel port, used when factory.yaml has no panel block. */
export const DEFAULT_PANEL_PORT = 7777;

export type StartApi = typeof startApi;

/** The dependencies of the panel API, built over the daemon's own database connection. */
export function apiDepsOf(
  daemon: Pick<Daemon, "db" | "github">,
  env: Record<string, string | undefined>,
  log?: (message: string) => void,
): ApiDeps {
  const { db } = daemon;
  return {
    events: createEventStore(db),
    issues: createIssueRepository(db),
    runs: createRunRepository(db),
    ledger: createLedgerRepository(db),
    runLedger: createRunLedgerReader(db),
    approvals: createApprovalStore(db),
    breaker: createBreakerStateRepository(db),
    enabled: createProjectEnabledRepository(db),
    projects: createProjectListReader(db),
    panelToken: env.FRIDAY_PANEL_TOKEN,
    unitOfWork: createUnitOfWork(db),
    github: { squashMerge: (pr, sha) => daemon.github.squashMerge(pr, sha) },
    readPrHead: async (pr) => (await daemon.github.getPrMergeState(pr)).headSha,
    now: Date.now,
    log,
  };
}

const MISSING_TOKEN_WARNING =
  "Aviso: FRIDAY_PANEL_TOKEN ausente; a leitura do painel fica aberta em 127.0.0.1. Não exponha a porta por túnel ou proxy sem o token.";

/** Logged when origins are set without a token; names the variables, never their values. */
export const MISSING_TOKEN_REFUSAL =
  "Painel não iniciado: FRIDAY_PANEL_ORIGINS está definida, mas FRIDAY_PANEL_TOKEN está ausente ou vazia. Defina FRIDAY_PANEL_TOKEN e reinicie o daemon; o daemon continua rodando sem o painel.";

/** Splits `FRIDAY_PANEL_ORIGINS` by comma, trimming spaces and dropping empty items. */
export function parseOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o !== "");
}

function panelErrorOf(error: unknown, port: number): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EADDRINUSE" ? new Error(`A porta ${port} do painel já está em uso.`) : error;
}

/**
 * Starts the panel API on the daemon's database; on failure releases the daemon and rethrows.
 * Returns null (and logs the refusal) when origins are set without a token: fail closed.
 */
export async function startPanel(
  daemon: Daemon,
  start: StartApi,
  port: number,
  log: (message: string) => void,
  env: Record<string, string | undefined>,
): Promise<RunningApi | null> {
  const origins = parseOrigins(env.FRIDAY_PANEL_ORIGINS);
  const noToken = env.FRIDAY_PANEL_TOKEN === undefined || env.FRIDAY_PANEL_TOKEN === "";
  if (noToken && origins.length > 0) {
    log(MISSING_TOKEN_REFUSAL);
    return null;
  }
  const refusal = panelRefusalOf(env);
  if (refusal !== null) {
    log(refusal);
    return null;
  }
  let api: RunningApi;
  try {
    api = await start({ deps: apiDepsOf(daemon, env, log), port, allowedOrigins: origins });
  } catch (error) {
    daemon.release();
    throw panelErrorOf(error, port);
  }
  if (noToken) log(MISSING_TOKEN_WARNING);
  log(`Painel em http://${api.address}:${api.port}`);
  return api;
}

/** Closes the panel API, ignoring a close error (used when startup already failed). */
export async function closePanelQuietly(api: RunningApi): Promise<void> {
  try {
    await api.close();
  } catch {
    // the startup error being reported matters more
  }
}
