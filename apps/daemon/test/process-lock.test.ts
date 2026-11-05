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

  it("never overwrites a lock created by another process after the read", () => {
    const { root, file } = tmpRoot();
    mkdirSync(join(root, ".friday"));
    expect(() =>
      acquireProcessLock(root, {
        pid: 111,
        kill: alive,
        beforeCreate: () => writeFileSync(file, "4242"),
      }),
    ).toThrow(AlreadyRunningError);
    expect(readFileSync(file, "utf8")).toBe("4242");
  });

  const staleKill = (p: number): void => {
    if (p === 999999) errno("ESRCH")();
  };
  function race(pid: number, root: string, deps: object, results: string[]): void {
    try {
      acquireProcessLock(root, { pid, kill: staleKill, ...deps });
      results.push(`ok${pid}`);
    } catch (e) {
      if (!(e instanceof AlreadyRunningError)) throw e;
      results.push(`busy${pid}`);
    }
  }

  it("lets only one process replace a stale lock when the 2nd runs between the last read and the removal", () => {
    const { root, file } = tmpRoot("999999");
    const results: string[] = [];
    race(111, root, { beforeRemove: () => race(222, root, { attempts: 2 }, results) }, results);
    expect(results.filter((r) => r.startsWith("ok"))).toEqual(["ok111"]);
    expect(readFileSync(file, "utf8")).toBe("111");
  });

  it("never exposes an empty lock: a 2nd process between creation and PID write loses", () => {
    const { root, file } = tmpRoot();
    const results: string[] = [];
    race(111, root, { beforeCreate: () => race(222, root, {}, results) }, results);
    expect(results.filter((r) => r.startsWith("ok"))).toEqual(["ok222"]);
    expect(readFileSync(file, "utf8")).toBe("222");
    expect(results).toContain("busy111");
  });

  it("never deletes a fresh lock created after the stale one was read", () => {
    const { root, file } = tmpRoot("999999");
    const results: string[] = [];
    let swapped = false;
    race(
      111,
      root,
      {
        beforeCreate: () => {
          if (swapped) return;
          swapped = true;
          writeFileSync(file, "4242");
        },
      },
      results,
    );
    expect(results).toEqual(["busy111"]);
    expect(readFileSync(file, "utf8")).toBe("4242");
  });

  it("treats a lock holding its own PID as stale", () => {
    const { root, file } = tmpRoot("1");
    acquireProcessLock(root, { pid: 1, kill: alive });
    expect(readFileSync(file, "utf8")).toBe("1");
  });
});
