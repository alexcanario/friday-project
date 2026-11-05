import {
  linkSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export class AlreadyRunningError extends Error {
  override readonly name = "AlreadyRunning";

  readonly pid: number | null;

  constructor(pid: number | null) {
    super(
      pid === null
        ? "Outra instância está adquirindo a trava do daemon."
        : `Já existe um daemon em execução (PID ${pid}).`,
    );
    this.pid = pid;
  }
}

export interface ProcessLockDeps {
  pid?: number;
  kill?: (pid: number, signal: 0) => void;
  attempts?: number;
  /** Test seams for races. */
  beforeCreate?: () => void;
  beforeRemove?: () => void;
}

const GUARD_STALE_MS = 30_000;

function readPid(file: string): number | null {
  let text: string;
  try {
    text = readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
  if (!/^\d+$/.test(text)) return null;
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

/** Only ESRCH means the process is gone; EPERM means it exists. */
function isAlive(pid: number, kill: (pid: number, signal: 0) => void): boolean {
  try {
    kill(pid, 0);
    return true;
  } catch (error) {
    return (error as { code?: string }).code !== "ESRCH";
  }
}

function sleep(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Creates the lock already holding the PID: temp file + hard link fails with EEXIST. */
function tryCreate(dir: string, file: string, pid: number): boolean {
  const tmp = join(dir, `daemon.lock.${pid}.${randomUUID()}.tmp`);
  writeFileSync(tmp, String(pid), { flag: "wx" });
  try {
    linkSync(tmp, file);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    return false;
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Cross-process mutex for stale recovery; null when another process holds it. */
function takeGuard(guard: string): (() => void) | null {
  try {
    writeFileSync(guard, "", { flag: "wx" });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") throw error;
    try {
      if (Date.now() - statSync(guard).mtimeMs > GUARD_STALE_MS) unlinkSync(guard);
    } catch {
      // the guard vanished meanwhile
    }
    return null;
  }
  return () => rmSync(guard, { force: true });
}

export function acquireProcessLock(root: string, deps: ProcessLockDeps = {}): { release(): void } {
  const pid = deps.pid ?? process.pid;
  const kill = deps.kill ?? ((p: number, s: 0) => process.kill(p, s));
  const dir = join(root, ".friday");
  const file = join(dir, "daemon.lock");
  const guard = `${file}.recover`;
  const attempts = deps.attempts ?? 50;
  mkdirSync(dir, { recursive: true });
  const live = (holder: number | null): holder is number =>
    // A holder with our own PID is stale: in a container PID 1 repeats across restarts.
    holder !== null && holder !== pid && isAlive(holder, kill);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    deps.beforeCreate?.();
    if (tryCreate(dir, file, pid)) {
      return { release: () => rmSync(file, { force: true }) };
    }
    const first = readPid(file);
    if (live(first)) throw new AlreadyRunningError(first);
    const unlock = takeGuard(guard);
    if (unlock === null) {
      sleep(10);
      continue;
    }
    try {
      // Re-check under the guard: only a stale lock is removed, never a fresh one.
      const holder = readPid(file);
      if (live(holder)) throw new AlreadyRunningError(holder);
      deps.beforeRemove?.();
      rmSync(file, { force: true });
    } finally {
      unlock();
    }
  }
  throw new AlreadyRunningError(readPid(file));
}
