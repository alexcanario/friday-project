import type { ApiDeps, RunningApi, startApi } from "@friday/api";
import type { Daemon } from "@friday/daemon";
import {
  createApprovalStore,
  createEventStore,
  createIssueRepository,
  createLedgerRepository,
  createRunRepository,
  type FridayDatabase,
} from "@friday/infrastructure";

/** Default panel port, used when factory.yaml has no panel block. */
export const DEFAULT_PANEL_PORT = 7777;

export type StartApi = typeof startApi;

/** The read-side dependencies of the panel API, built over the daemon's own database connection. */
export function apiDepsOf(db: FridayDatabase): ApiDeps {
  return {
    events: createEventStore(db),
    issues: createIssueRepository(db),
    runs: createRunRepository(db),
    ledger: createLedgerRepository(db),
    approvals: createApprovalStore(db),
    now: Date.now,
  };
}

function panelErrorOf(error: unknown, port: number): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  return code === "EADDRINUSE" ? new Error(`A porta ${port} do painel já está em uso.`) : error;
}

/** Starts the panel API on the daemon's database; on failure releases the daemon and rethrows. */
export async function startPanel(
  daemon: Daemon,
  start: StartApi,
  port: number,
  log: (message: string) => void,
): Promise<RunningApi> {
  let api: RunningApi;
  try {
    api = await start({ deps: apiDepsOf(daemon.db), port });
  } catch (error) {
    daemon.release();
    throw panelErrorOf(error, port);
  }
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
