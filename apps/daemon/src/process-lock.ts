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
  const holder = readPid(file);
  if (holder !== null && isAlive(holder, kill)) throw new AlreadyRunningError(holder);
  writeFileSync(file, String(pid));
  return {
    release() {
      rmSync(file, { force: true });
    },
  };
}
