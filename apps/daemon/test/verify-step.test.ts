import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createWorkflow, transition } from "@friday/domain";
import type { IssueState, WorkflowInput, WorkflowSnapshot } from "@friday/domain";
import * as daemon from "../src/index.ts";
import { gitHead, runVerifyStep, type VerifyStepOutcome } from "../src/index.ts";

const SHA = "a".repeat(40);
const FIXTURE = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const BASE_ENV = { PATH: process.env.PATH, HOME: process.env.HOME };

function tmp(): string {
  return mkdtempSync(join(tmpdir(), "verify-step-"));
}

function registry(command: string, timeoutS = 60): string {
  const root = tmp();
  cpSync(FIXTURE, root, { recursive: true });
  const file = join(root, "factory.yaml");
  const yaml = readFileSync(file, "utf8").replace(
    /verify:\r?\n {2}command: .*\r?\n {2}timeout_s: .*\r?\n/,
    `verify:\n  command: ${JSON.stringify(command)}\n  timeout_s: ${timeoutS}\n`,
  );
  writeFileSync(file, yaml);
  return root;
}

interface Opts {
  timeoutS?: number;
  env?: Record<string, string | undefined>;
  head?: string;
  root?: string;
  worktree?: string;
}

function run(command: string, o: Opts = {}): Promise<VerifyStepOutcome> {
  const worktree = o.worktree ?? tmp();
  return runVerifyStep(
    {
      registryRoot: o.root ?? registry(command, o.timeoutS),
      env: o.env ?? BASE_ENV,
      readHead: async () => o.head ?? SHA,
    },
    { worktreePath: worktree, headSha: SHA },
  );
}

function snapAt(state: IssueState, extra: Partial<WorkflowSnapshot> = {}): WorkflowSnapshot {
  const created = createWorkflow("i-1");
  if (!created.ok) throw new Error("createWorkflow failed");
  return { ...created.value, state, ...extra };
}

function apply(snapshot: WorkflowSnapshot, input: WorkflowInput): WorkflowSnapshot {
  const r = transition(snapshot, input);
  if (!r.ok) throw new Error(r.error);
  return r.value.snapshot;
}

describe("runVerifyStep", () => {
  it("maps exit 0 to VerifyPassed, exit 1 and a killing signal to VerifyFailed", async () => {
    const pass = await run(`node -e "process.exit(0)"`);
    expect(pass).toEqual({ input: { type: "VerifyPassed" } });
    expect("feedback" in pass).toBe(false);
    expect(apply(snapAt("Verify"), pass.input).state).toBe("QA");
    const fail = await run(`node -e "process.exit(1)"`);
    expect(fail.input.type).toBe("VerifyFailed");
    const after = apply(snapAt("Verify"), fail.input);
    expect(after.state).toBe("InProgress");
    expect(after.verifyRound).toBe(1);
    const killed = await run(`node -e "process.kill(process.pid,'SIGKILL')"`);
    expect(killed.input.type).toBe("VerifyFailed");
  });

  it("runs the registry command inside the worktree, ignores the worktree factory.yaml and holds on an invalid registry", async () => {
    const worktree = tmp();
    await run(`node -e "require('node:fs').writeFileSync('cwd.txt',process.cwd())"`, { worktree });
    expect(realpathSync(readFileSync(join(worktree, "cwd.txt"), "utf8"))).toBe(
      realpathSync(worktree),
    );
    const other = tmp();
    writeFileSync(
      join(other, "factory.yaml"),
      `verify:\n  command: "node -e \\"require('node:fs').writeFileSync('pwned.txt','x')\\""\n  timeout_s: 5\n`,
    );
    const out = await run(`node -e "process.exit(0)"`, { worktree: other });
    expect(out.input.type).toBe("VerifyPassed");
    expect(existsSync(join(other, "pwned.txt"))).toBe(false);
    const bad = registry(`node -e "require('node:fs').writeFileSync('marker.txt','x')"`);
    writeFileSync(join(bad, "factory.yaml"), "enabled: [\n");
    const marker = tmp();
    const held = await run("true", { root: bad, worktree: marker });
    expect(held.input).toEqual({ type: "RunHeld", reason: "RunMisconfigured" });
    expect(existsSync(join(marker, "marker.txt"))).toBe(false);
  });

  it("retries twice, holds on the third failure and keeps verifyRound after a pass", async () => {
    let s = snapAt("Verify");
    for (const round of [1, 2]) {
      s = apply(s, (await run(`node -e "process.exit(1)"`)).input);
      expect(s.state).toBe("InProgress");
      expect(s.verifyRound).toBe(round);
      s = { ...s, state: "Verify" };
    }
    s = apply(s, (await run(`node -e "process.exit(1)"`)).input);
    expect(s.state).toBe("Held");
    expect(s.heldReason).toBe("VerifyRoundsExhausted");
    expect(s.verifyRound).toBe(3);
    const passed = apply(
      snapAt("Verify", { verifyRound: 2 }),
      (await run(`node -e "process.exit(0)"`)).input,
    );
    expect(passed.state).toBe("QA");
    expect(passed.verifyRound).toBe(2);
    const again = apply(
      { ...passed, state: "Verify" },
      (await run(`node -e "process.exit(1)"`)).input,
    );
    expect(again.heldReason).toBe("VerifyRoundsExhausted");
    expect(again.verifyRound).toBe(3);
  });

  it("kills a command and its grandchild over timeout_s and holds with VerifyTimeout", async () => {
    const started = Date.now();
    const out = await run(`node -e "setTimeout(()=>{},60000)"`, { timeoutS: 1 });
    expect(Date.now() - started).toBeLessThan(5000);
    expect(out.input).toEqual({ type: "VerifyTimedOut" });
    expect(apply(snapAt("Verify"), out.input).heldReason).toBe("VerifyTimeout");

    const worktree = tmp();
    const cmd = `node -e "const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{stdio:'ignore'});require('node:fs').writeFileSync('grandchild.pid',String(c.pid));setTimeout(()=>{},60000)"`;
    const res = await run(cmd, { timeoutS: 1, worktree });
    expect(res.input.type).toBe("VerifyTimedOut");
    const pid = Number(readFileSync(join(worktree, "grandchild.pid"), "utf8"));
    const deadline = Date.now() + 5000;
    let gone = false;
    while (!gone && Date.now() < deadline) {
      try {
        process.kill(pid, 0);
        await new Promise((r) => setTimeout(r, 100));
      } catch (e) {
        gone = (e as NodeJS.ErrnoException).code === "ESRCH";
      }
    }
    expect(gone).toBe(true);
    const quick = await run(`node -e "process.exit(0)"`, { timeoutS: 1 });
    expect(quick.input.type).not.toBe("VerifyTimedOut");
  }, 15000);

  describe("detached grandchild holding the pipes", () => {
    const leaked: number[] = [];
    const holder = (parentTail: string) =>
      `node -e "const c=require('node:child_process').spawn(process.execPath,['-e','setTimeout(()=>{},60000)'],{detached:true,stdio:'inherit'});require('node:fs').writeFileSync('holder.pid',String(c.pid));${parentTail}"`;
    const remember = (worktree: string): void => {
      try {
        leaked.push(Number(readFileSync(join(worktree, "holder.pid"), "utf8")));
      } catch {
        // the pid file was never written
      }
    };
    afterEach(() => {
      for (const pid of leaked.splice(0)) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
          // already gone
        }
      }
    });

    it("returns VerifyTimedOut within 5000 ms when a detached grandchild keeps the pipes open", async () => {
      const worktree = tmp();
      const started = Date.now();
      try {
        const out = await run(holder("setTimeout(()=>{},60000)"), { timeoutS: 1, worktree });
        expect(out.input).toEqual({ type: "VerifyTimedOut" });
        expect(Date.now() - started).toBeLessThan(5000);
      } finally {
        remember(worktree);
      }
    }, 30000);

    it("returns VerifyPassed when the command exits 0 and leaves a grandchild holding the pipes", async () => {
      const worktree = tmp();
      const started = Date.now();
      try {
        const out = await run(holder("process.exit(0)"), { timeoutS: 3, worktree });
        expect(out.input).toEqual({ type: "VerifyPassed" });
        expect(Date.now() - started).toBeLessThan(3000);
      } finally {
        remember(worktree);
      }
    }, 30000);
  });

  it("returns the last 4000 characters of stdout and stderr only on failure", async () => {
    const a = await run(`node -e "console.error('boom-marker');process.exit(2)"`);
    expect(a).toMatchObject({ input: { type: "VerifyFailed" } });
    expect((a as { feedback: string }).feedback).toContain("boom-marker");
    const b = await run(
      `node -e "console.log('out-marker');console.error('err-marker');process.exit(1)"`,
    );
    const fb = (b as { feedback: string }).feedback;
    expect(fb).toContain("out-marker");
    expect(fb).toContain("err-marker");
    const c = await run(
      `node -e "process.stdout.write('a'.repeat(1000)+'b'.repeat(4000));process.exit(1)"`,
    );
    expect((c as { feedback: string }).feedback).toBe("b".repeat(4000));
    const d = await run(`node -e "process.stdout.write('x'.repeat(100));process.exit(1)"`);
    expect((d as { feedback: string }).feedback).toBe("x".repeat(100));
    const e = await run(`node -e "console.log('some text');process.exit(0)"`);
    expect("feedback" in e).toBe(false);
  });

  it("runs the command without ANTHROPIC_API_KEY and other host variables", async () => {
    const env = { ...BASE_ENV, ANTHROPIC_API_KEY: "k-secret", GH_TOKEN: "t-secret" };
    const a = await run(
      `node -e "process.exit(process.env.ANTHROPIC_API_KEY||process.env.GH_TOKEN?1:0)"`,
      { env },
    );
    expect(a.input.type).toBe("VerifyPassed");
    const b = await run(
      `node -e "process.exit(Object.keys(process.env).some(k=>k.toLowerCase()==='anthropic_api_key')?1:0)"`,
      { env: { ...BASE_ENV, anthropic_api_key: "k-lower" } },
    );
    expect(b.input.type).toBe("VerifyPassed");
    const c = await run(`node -e "process.exit(process.env.PATH?0:1)"`);
    expect(c.input.type).toBe("VerifyPassed");
  });

  it("does not run and returns VerifyHeadChanged when HEAD differs, and gitHead reads the real HEAD", async () => {
    const worktree = tmp();
    const cmd = `node -e "require('node:fs').writeFileSync('ran.txt','x')"`;
    const out = await run(cmd, { head: "b".repeat(40), worktree });
    expect(out.input).toEqual({ type: "VerifyHeadChanged" });
    expect(existsSync(join(worktree, "ran.txt"))).toBe(false);
    expect(apply(snapAt("Verify"), out.input).heldReason).toBe("HeadChanged");
    await run(cmd, { worktree });
    expect(existsSync(join(worktree, "ran.txt"))).toBe(true);

    const w2 = tmp();
    await expect(
      runVerifyStep(
        {
          registryRoot: registry(cmd),
          env: BASE_ENV,
          readHead: async () => {
            throw new Error("boom");
          },
        },
        { worktreePath: w2, headSha: SHA },
      ),
    ).rejects.toThrow("boom");
    expect(existsSync(join(w2, "ran.txt"))).toBe(false);

    const repo = tmp();
    const git = (...args: string[]) =>
      execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
        cwd: repo,
        encoding: "utf8",
      });
    git("init", "-q");
    git("commit", "-q", "--allow-empty", "-m", "one");
    const first = await gitHead(repo);
    expect(first).toBe(git("rev-parse", "HEAD").trim());
    expect(first).toMatch(/^[0-9a-f]{40}$/);
    git("commit", "-q", "--allow-empty", "-m", "two");
    const second = await gitHead(repo);
    expect(second).not.toBe(first);
    expect(second).toBe(git("rev-parse", "HEAD").trim());
  });

  it("is exported by the package index and stays under 300 lines", () => {
    expect(typeof daemon.runVerifyStep).toBe("function");
    expect(typeof daemon.gitHead).toBe("function");
    const src = readFileSync(join(import.meta.dirname, "../src/verify-step.ts"), "utf8");
    expect(src.split("\n").length).toBeLessThanOrEqual(300);
  });

  it("rejects when the command cannot be spawned", async () => {
    await expect(
      run(`node -e "process.exit(0)"`, { worktree: join(tmp(), "missing") }),
    ).rejects.toBeDefined();
  });
});
