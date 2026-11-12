import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEventStore,
  createIssueRepository,
  openDatabase,
  type FridayDatabase,
} from "@friday/infrastructure";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runResume, type ResumeDeps } from "../src/resume.ts";
import { root } from "./helpers.ts";

const USAGE = "Uso: friday resume <issue> --db <arquivo> --project <id>\n";
const SEED_AT = "2026-11-12T00:00:00.000Z";

let db: FridayDatabase;
let closes: number;
beforeEach(() => {
  db = openDatabase(join(mkdtempSync(join(tmpdir(), "friday-resume-")), "friday.db"));
  db.sqlite.prepare("INSERT INTO projects (id) VALUES (?)").run("p1");
  closes = 0;
});
afterEach(() => db.close());

function seed(
  issue: number,
  to: string,
  heldReason: string | null = null,
  verifyRound = 0,
  reviewIter = 0,
) {
  createEventStore(db).append({
    projectId: "p1",
    issueId: issue,
    runId: null,
    type: "StateChanged",
    actor: "seed",
    at: SEED_AT,
    payload: {
      type: "StateChanged",
      issueId: String(issue),
      from: "Todo",
      to,
      trigger: "SpecialistAssigned",
      heldReason,
      verifyRound,
      qaRound: 0,
      reviewIter,
    },
  });
  createIssueRepository(db).rebuild("p1");
}

function deps(over: Partial<ResumeDeps> = {}): ResumeDeps {
  return {
    events: createEventStore(db),
    issues: createIssueRepository(db),
    now: () => Date.parse("2026-11-12T10:00:00.000Z"),
    close: () => {
      closes += 1;
    },
    ...over,
  };
}

const args = (issue: string) => ["resume", issue, "--db", "x.db", "--project", "p1"];
const run = (issue: string, d: ResumeDeps = deps()) => runResume(args(issue), () => d);

describe("friday resume", () => {
  it("resume writes StateChanged Resumed as human:cli", async () => {
    seed(7, "Held", "SchemaInvalid");
    const out = await run("7");
    expect(out).toEqual({ stdout: "Issue 7 retomada.\n", stderr: "", code: 0 });
    const last = createEventStore(db).list("p1", 7).at(-1);
    expect(last?.type).toBe("StateChanged");
    expect(last?.actor).toBe("human:cli");
    expect(last?.payload).toMatchObject({ trigger: "Resumed", from: "Held", to: "InProgress" });
  });

  it("resume leaves the issue InProgress without a held reason", async () => {
    seed(7, "Held", "SchemaInvalid");
    await run("7");
    const row = createIssueRepository(db).get("p1", 7);
    expect(row?.state).toBe("InProgress");
    expect(row?.heldReason).toBeNull();
  });

  it("resume resets only the counter of the held reason", async () => {
    seed(7, "Held", "VerifyRoundsExhausted", 3);
    await run("7");
    expect(createIssueRepository(db).get("p1", 7)?.verifyRound).toBe(0);
  });

  it("resume releases an issue held by JudgeContextMissing and keeps the counters", async () => {
    seed(7, "Held", "JudgeContextMissing", 0, 2);
    const out = await run("7");
    expect(out).toEqual({ stdout: "Issue 7 retomada.\n", stderr: "", code: 0 });
    const last = createEventStore(db).list("p1", 7).at(-1);
    expect(last?.type).toBe("StateChanged");
    expect(last?.actor).toBe("human:cli");
    expect(last?.payload).toMatchObject({ trigger: "Resumed", from: "Held", to: "InProgress" });
    const row = createIssueRepository(db).get("p1", 7);
    expect(row).toMatchObject({ state: "InProgress", heldReason: null, reviewIter: 2 });
  });

  it("resume refuses an issue that is not Held and writes nothing", async () => {
    seed(8, "InProgress");
    const before = createEventStore(db).list("p1", 8).length;
    const out = await run("8");
    expect(out).toEqual({ stdout: "", stderr: "A issue 8 não está retida (Held).\n", code: 1 });
    expect(createEventStore(db).list("p1", 8)).toHaveLength(before);
  });

  it("resume refuses an unknown issue and writes nothing", async () => {
    const out = await run("99");
    expect(out).toEqual({ stdout: "", stderr: "Issue 99 não encontrada.\n", code: 1 });
    expect(createEventStore(db).list("p1", 99)).toHaveLength(0);
  });

  it("resume fails closed on missing or invalid arguments without opening the db", async () => {
    const cases = [
      ["resume", "7", "--project", "p1"],
      ["resume", "7", "--db", "", "--project", "p1"],
      ["resume", "7", "--db", "x.db"],
      ["resume", "--db", "x.db", "--project", "p1"],
      ["resume", "abc", "--db", "x.db", "--project", "p1"],
      ["resume", "0", "--db", "x.db", "--project", "p1"],
      ["resume", "-1", "--db", "x.db", "--project", "p1"],
    ];
    let opened = 0;
    for (const c of cases) {
      const out = await runResume(c, () => {
        opened += 1;
        return deps();
      });
      expect(out, c.join(" ")).toEqual({ stdout: "", stderr: USAGE, code: 2 });
    }
    expect(opened).toBe(0);
  });

  it("resume reports open, write and no-op failures and closes the client", async () => {
    const openFail = await runResume(args("7"), () => {
      throw new Error("boom");
    });
    expect(openFail).toEqual({ stdout: "", stderr: "Falha ao abrir o banco.\n", code: 1 });
    expect(closes).toBe(0);

    seed(7, "Held", "SchemaInvalid");
    const real = createEventStore(db);
    const throwing = await run(
      "7",
      deps({
        events: {
          ...real,
          append: () => {
            throw new Error("x");
          },
        },
      }),
    );
    expect(throwing).toEqual({ stdout: "", stderr: "Falha ao retomar a issue.\n", code: 1 });
    expect(closes).toBe(1);

    const noop = await run(
      "7",
      deps({ events: { list: real.list, append: (e) => ({ ...e }) as never } }),
    );
    expect(noop).toEqual({ stdout: "", stderr: "Falha ao retomar a issue.\n", code: 1 });
    expect(closes).toBe(2);

    const closeFail = await run(
      "7",
      deps({
        close: () => {
          throw new Error("close");
        },
      }),
    );
    expect(closeFail.code).toBe(0);
  });

  it("resume twice only resumes once", async () => {
    seed(7, "Held", "SchemaInvalid");
    expect((await run("7")).code).toBe(0);
    expect((await run("7")).code).toBe(1);
    const resumed = createEventStore(db)
      .list("p1", 7)
      .filter((e) => (e.payload as { trigger?: string }).trigger === "Resumed");
    expect(resumed).toHaveLength(1);
  });

  it("index.ts routes resume and prints its usage", () => {
    const home = mkdtempSync(join(tmpdir(), "friday-home-"));
    const r = spawnSync(process.execPath, ["apps/cli/src/index.ts", "resume"], {
      cwd: root,
      encoding: "utf8",
      env: { PATH: process.env.PATH, FRIDAY_HOME: home },
    });
    expect(r.status).toBe(2);
    expect(r.stderr).toBe(USAGE);
  });
});
