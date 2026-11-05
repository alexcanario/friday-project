import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export class AlreadyRunningError extends Error {
  override readonly name = "AlreadyRunning";

  readonly pid: number;

  constructor(pid: number) {
    super(`Já existe um daemon em execução (PID ${pid}).`);
    this.pid = pid;
  }
}

export interface ProcessLockDeps {
  pid?: number;
  kill?: (pid: number, signal: 0) => void;
  /** Test seams for races. */
  beforeCreate?: () => void;
  onStale?: () => void;
}

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

export function acquireProcessLock(root: string, deps: ProcessLockDeps = {}): { release(): void } {
  const pid = deps.pid ?? process.pid;
  const kill = deps.kill ?? ((p: number, s: 0) => process.kill(p, s));
  const dir = join(root, ".friday");
  const file = join(dir, "daemon.lock");
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    deps.beforeCreate?.();
    try {
      writeFileSync(file, String(pid), { flag: "wx" });
      return {
        release() {
          rmSync(file, { force: true });
        },
      };
    } catch (error) {
      if ((error as { code?: string }).code !== "EEXIST") throw error;
    }
    const holder = readPid(file);
    // A holder with our own PID is stale: in a container PID 1 repeats across restarts.
    if (holder !== null && holder !== pid && isAlive(holder, kill)) {
      throw new AlreadyRunningError(holder);
    }
    deps.onStale?.();
    // Remove only if nobody replaced the stale lock meanwhile.
    if (readPid(file) === holder) rmSync(file, { force: true });
  }
  throw new AlreadyRunningError(readPid(file) ?? 0);
}
