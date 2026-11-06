import type { UnitOfWork } from "@friday/application";
import type { FridayDatabase } from "./database.ts";

/**
 * One SQLite transaction on the shared connection, so every repository built on `db` joins it.
 * Callers of `IssueRepository.rebuild` (which opens its own transaction) must do it outside `run`.
 */
export function createUnitOfWork(db: FridayDatabase): UnitOfWork {
  return {
    run: (work) => db.sqlite.transaction(work)(),
  };
}
