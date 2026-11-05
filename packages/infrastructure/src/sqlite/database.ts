import { realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema.ts";

export interface FridayDatabase {
  readonly sqlite: Database.Database;
  readonly orm: BetterSQLite3Database<typeof schema>;
  close(): void;
}

export interface OpenDatabaseOptions {
  /** Opens the native connection; injectable so tests can observe the options. */
  open?: (path: string, options?: Database.Options) => Database.Database;
}

const BUSY_TIMEOUT_MS = 5000;
const migrationsFolder = resolve(import.meta.dirname, "../../drizzle");
const openPaths = new Set<string>();

/** One identity per file, whatever link or alias reaches it; the file itself may not exist yet. */
function fileIdentity(path: string): string {
  const absolute = resolve(path);
  try {
    return realpathSync.native(absolute);
  } catch {
    try {
      return join(realpathSync.native(dirname(absolute)), basename(absolute));
    } catch {
      return absolute;
    }
  }
}

export function openDatabase(path: string, options: OpenDatabaseOptions = {}): FridayDatabase {
  const key = fileIdentity(path);
  if (openPaths.has(key)) {
    throw new Error(`O banco já está aberto neste processo: ${key}`);
  }
  const open = options.open ?? ((p, o) => new Database(p, o));
  const sqlite = open(path, { timeout: BUSY_TIMEOUT_MS });
  try {
    sqlite.pragma("journal_mode = WAL");
    sqlite.pragma("foreign_keys = ON");
    // Without this, INSERT OR REPLACE deletes a row without firing the append-only trigger.
    sqlite.pragma("recursive_triggers = ON");
    const orm = drizzle(sqlite, { schema });
    migrate(orm, { migrationsFolder });
    openPaths.add(key);
    let closed = false;
    return {
      sqlite,
      orm,
      close() {
        if (closed) return;
        closed = true;
        sqlite.close();
        openPaths.delete(key);
      },
    };
  } catch (error) {
    sqlite.close();
    throw error;
  }
}
