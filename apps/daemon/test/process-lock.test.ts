import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { AlreadyRunningError, acquireProcessLock } from "../src/index.ts";

const alive = (): void => {};
const errno = (code: string) => () => {
  throw Object.assign(new Error(code), { code });
};

function tmpRoot(lock?: string): { root: string; file: string } {
  const root = mkdtempSync(join(tmpdir(), "friday-lock-"));
  const file = join(root, ".friday", "daemon.lock");
  if (lock !== undefined) {
    mkdirSync(join(root, ".friday"));
    writeFileSync(file, lock);
  }
  return { root, file };
}

describe("acquireProcessLock", () => {
  it("refuses a live second instance, also when kill throws EPERM", () => {
    for (const kill of [alive, errno("EPERM")]) {
      const { root, file } = tmpRoot("4242");
      let error: unknown;
      try {
        acquireProcessLock(root, { pid: 111, kill });
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(AlreadyRunningError);
      expect((error as Error).name).toBe("AlreadyRunning");
      expect((error as Error).message).toBe("Já existe um daemon em execução (PID 4242).");
      expect(readFileSync(file, "utf8")).toBe("4242");
    }
  });

  it("takes a free lock, creates the folder and releases", () => {
    const { root, file } = tmpRoot();
    const lock = acquireProcessLock(root, { pid: 111 });
    expect(readFileSync(file, "utf8")).toBe("111");
    expect(() => acquireProcessLock(root, { pid: 222, kill: alive })).toThrow(AlreadyRunningError);
    lock.release();
    expect(existsSync(file)).toBe(false);
    expect(() => acquireProcessLock(root, { pid: 222 })).not.toThrow();
  });

  it("takes a stale lock on ESRCH or unparseable content", () => {
    const stale = tmpRoot("999999");
    acquireProcessLock(stale.root, { pid: 111, kill: errno("ESRCH") });
    expect(readFileSync(stale.file, "utf8")).toBe("111");
    const junk = tmpRoot("abc");
    acquireProcessLock(junk.root, { pid: 111, kill: alive });
    expect(readFileSync(junk.file, "utf8")).toBe("111");
  });
});
