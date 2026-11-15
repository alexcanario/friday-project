import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, expect, it, vi } from "vitest";
import { readReviewCredential } from "@friday/daemon";
import {
  createProductionRunner,
  type ProductionInput,
  type ProductionSeams,
} from "../src/eval-run-production.ts";
import { CLAIMS, REQUEST, fakes, removeWorkspaces, workspace } from "./eval-run-fakes.ts";

type Ws = ReturnType<typeof workspace>;

afterEach(removeWorkspaces);

function inputOf(ws: Ws, over: Partial<ProductionInput> = {}): ProductionInput {
  return {
    registryRoot: ws.registryRoot,
    env: ws.env,
    homeDir: join(ws.base, "user"),
    now: () => 1_000,
    criteriaById: new Map([["E1", CLAIMS]]),
    ...over,
  };
}

async function messageOf(promise: Promise<unknown>): Promise<string | null> {
  return promise.then(
    () => null,
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );
}

type Case = {
  name: string;
  message: (ws: Ws) => string;
  prepare?: (ws: Ws) => Partial<ProductionInput> | void;
  seams?: Partial<ProductionSeams>;
};

const CASES: Case[] = [
  {
    name: "empty root",
    prepare: (ws) => {
      const empty = join(ws.base, "empty");
      mkdirSync(empty);
      return { registryRoot: empty };
    },
    message: () => "O factory.yaml está inválido ou ausente.",
  },
  {
    name: "other repository",
    prepare: (ws) => ws.edit("factory.yaml", "name: friday-sandbox", "name: outro-repo"),
    message: () =>
      "Erro: o experimento só roda no repositório friday-sandbox (configurado: alexcanario/outro-repo)",
  },
  {
    name: "missing frontend card",
    prepare: (ws) => rmSync(join(ws.registryRoot, "agents", "frontend.yaml")),
    message: () => "A ficha frontend não está no registro central.",
  },
  {
    name: "author_app",
    prepare: (ws) =>
      ws.edit(
        "factory.yaml",
        "author_token_env: FRIDAY_AUTHOR_TOKEN",
        "author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: /keys/author.pem",
      ),
    message: () => "O experimento só suporta pull_requests.author_token_env.",
  },
  {
    name: "relative FRIDAY_HOME",
    prepare: (ws) => ({ env: { ...ws.env, FRIDAY_HOME: "rel/home" } }),
    message: () => "A variável FRIDAY_HOME deve ser um caminho absoluto.",
  },
  {
    name: "invalid specialist card",
    prepare: (ws) =>
      ws.edit(
        "agents/generic.yaml",
        "mcp_tools: [work_report,",
        "mcp_tools: [review_verdict, work_report,",
      ),
    message: () => "A ficha do especialista é inválida.",
  },
  {
    name: "missing clone",
    prepare: (ws) => rmSync(ws.repoDir, { recursive: true }),
    message: (ws) => `Erro: o clone do repositório não existe: ${ws.repoDir}`,
  },
  {
    name: "empty author token",
    prepare: (ws) => ({ env: { ...ws.env, FRIDAY_AUTHOR_TOKEN: "" } }),
    message: () => "A variável FRIDAY_AUTHOR_TOKEN está vazia ou ausente.",
  },
  {
    name: "no review credential",
    seams: { readReview: () => null },
    message: () => "O token de revisão não está configurado no factory.yaml.",
  },
  {
    name: "missing review token",
    prepare: (ws) => ({ env: { ...ws.env, FRIDAY_REVIEW_TOKEN: undefined } }),
    message: () => "A variável FRIDAY_REVIEW_TOKEN está vazia ou ausente.",
  },
];

it("refuses invalid config, other repository and missing credentials before any side effect", async () => {
  for (const c of CASES) {
    const ws = workspace();
    const over = c.prepare?.(ws) ?? {};
    const f = fakes(ws.tmpRoot);
    const message = await messageOf(
      createProductionRunner(inputOf(ws, over), { ...f.seams, ...c.seams }),
    );
    expect(message, c.name).toBe(c.message(ws));
    expect(f.seams.createRuntime, c.name).not.toHaveBeenCalled();
    expect(f.seams.createWorktrees, c.name).not.toHaveBeenCalled();
    expect(f.seams.createGitHost, c.name).not.toHaveBeenCalled();
    expect(f.seams.createGitHub, c.name).not.toHaveBeenCalled();
    expect(readdirSync(ws.tmpRoot), c.name).toEqual([]);
  }
});

it("wires the worktrees, git host and GitHub from the factory config", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  const { runner, close } = await createProductionRunner(inputOf(ws), f.seams);
  try {
    expect(f.seams.createWorktrees.mock.calls).toEqual([[{ repoDir: ws.repoDir }]]);
    expect(f.seams.createGitHost.mock.calls).toEqual([
      [
        {
          tokenEnv: "FRIDAY_AUTHOR_TOKEN",
          repoDir: ws.repoDir,
          mirrorDir: join(ws.home, "mirrors", "alexcanario__friday-sandbox.git"),
          targetUrl: "https://github.com/alexcanario/friday-sandbox.git",
          env: ws.env,
        },
      ],
    ]);
    expect(f.seams.createGitHub.mock.calls[0]).toEqual([
      "author-tok",
      { owner: "alexcanario", repo: "friday-sandbox" },
    ]);
    await runner.run(REQUEST);
    expect(vi.mocked(f.worktrees.create).mock.calls[0]![0]).toMatchObject({
      root: join(ws.home, "worktrees"),
      project: "alexcanario__friday-sandbox",
      base: "develop",
    });
  } finally {
    close();
  }
});

it("runs one issue end to end with an active run row per runtime call", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  const { runner, close } = await createProductionRunner(inputOf(ws), f.seams);
  try {
    const outcome = await runner.run(REQUEST);
    expect(outcome).toMatchObject({
      status: "done",
      costUsd: 1,
      rounds: 2,
      judgeFirstRound: true,
    });
    expect(vi.mocked(f.github.listIssuesByLabel).mock.calls).toEqual([["experimento-d112"]]);
    expect(f.seen).toHaveLength(3);
    expect(new Set(f.seen).size).toBe(3);
    expect(f.activeAtCall).toEqual([true, true, true]);
    expect(f.seen.map((id) => f.isActive(id))).toEqual([false, false, false]);
    expect(f.postReview).toHaveBeenCalledTimes(1);
    expect(f.seams.createGitHub.mock.calls[1]).toEqual([
      "review-tok",
      { owner: "alexcanario", repo: "friday-sandbox" },
    ]);
  } finally {
    close();
  }
});

it("masks the author and review tokens in the errors of the runner", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot, { createFails: new Error("falhou author-tok e review-tok") });
  const { runner, close } = await createProductionRunner(inputOf(ws), f.seams);
  try {
    expect(await messageOf(runner.run(REQUEST))).toBe("falhou *** e ***");
  } finally {
    close();
  }
});

it("creates the project row and removes the temporary database on close", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  const { close } = await createProductionRunner(inputOf(ws), f.seams);
  const dirs = readdirSync(ws.tmpRoot);
  expect(dirs).toHaveLength(1);
  expect(dirs[0]).toMatch(/^friday-eval-/);
  const dbPath = join(ws.tmpRoot, dirs[0]!, "eval.db");
  expect(existsSync(dbPath)).toBe(true);
  const reader = new DatabaseSync(dbPath, { readOnly: true });
  try {
    expect(reader.prepare("SELECT id FROM projects").all()).toEqual([
      { id: "alexcanario/friday-sandbox" },
    ]);
  } finally {
    reader.close();
  }
  close();
  expect(readdirSync(ws.tmpRoot)).toEqual([]);
  expect(() => close()).not.toThrow();
});

it("the daemon exports readReviewCredential", () => {
  expect(typeof readReviewCredential).toBe("function");
});
