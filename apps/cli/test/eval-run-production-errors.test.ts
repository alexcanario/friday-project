import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { runEvalRun } from "../src/eval-run.ts";
import {
  createProductionRunner,
  type ProductionInput,
  type ProductionSeams,
} from "../src/eval-run-production.ts";
import { CLAIMS, REQUEST, fakes, removeWorkspaces, workspace } from "./eval-run-fakes.ts";

afterEach(removeWorkspaces);

type Ws = ReturnType<typeof workspace>;

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

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  return promise.then(
    () => {
      throw new Error("expected the composition to reject");
    },
    (error: unknown) => error as Error,
  );
}

const THROWING = ["createGitHub", "createGitHost", "createWorktrees"] as const;

function throwing(message: string, cause?: string) {
  return vi.fn().mockImplementation(() => {
    throw new Error(message, cause === undefined ? undefined : { cause: new Error(cause) });
  });
}

it("masks the tokens in the errors of the adapters it builds", async () => {
  for (const name of THROWING) {
    const ws = workspace();
    const f = fakes(ws.tmpRoot);
    const seams: ProductionSeams = {
      ...f.seams,
      [name]: throwing("falhou author-tok e review-tok", "causa review-tok"),
    };
    const error = await rejectionOf(createProductionRunner(inputOf(ws), seams));
    expect(error.message, name).toBe("falhou *** e ***");
    expect(error.stack, name).not.toContain("author-tok");
    expect(error.stack, name).not.toContain("review-tok");
    expect(error.cause, name).toBeInstanceOf(Error);
    expect((error.cause as Error).message, name).toBe("causa ***");
    expect(f.seams.createRuntime, name).not.toHaveBeenCalled();
    expect(readdirSync(ws.tmpRoot), name).toEqual([]);

    const clean = await rejectionOf(
      createProductionRunner(inputOf(ws), { ...f.seams, [name]: throwing("falhou sem segredo") }),
    );
    expect(clean.message, name).toBe("falhou sem segredo");
  }
});

it("masks a thrown value that is not an Error and keeps the normal path", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  const createGitHost = vi.fn().mockImplementation(() => {
    throw "falhou author-tok";
  });
  const error = await rejectionOf(
    createProductionRunner(inputOf(ws), { ...f.seams, createGitHost }),
  );
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toBe("falhou ***");

  const ok = fakes(ws.tmpRoot);
  const { runner, close } = await createProductionRunner(inputOf(ws), ok.seams);
  try {
    expect((await runner.run(REQUEST)).status).toBe("done");
  } finally {
    close();
  }
});

it("prints the masked error on the stderr of friday eval --run variants", async () => {
  const ws = workspace();
  const out = join(ws.base, "runs.json");
  const args = ["eval", "--run", "variants", "--output", out];
  const deps = (seams: ProductionSeams) => ({
    registryRoot: ws.registryRoot,
    env: ws.env,
    homeDir: join(ws.base, "user"),
    now: () => 1_000,
    createRunner: (input: ProductionInput) => createProductionRunner(input, seams),
  });
  const failing = {
    ...fakes(ws.tmpRoot).seams,
    createGitHost: throwing("falhou author-tok e review-tok"),
  };
  expect(await runEvalRun(args, deps(failing))).toEqual({
    stdout: "",
    stderr: "falhou *** e ***\n",
    code: 2,
  });
  expect(existsSync(out)).toBe(false);

  const normal = await runEvalRun(args, deps(fakes(ws.tmpRoot).seams));
  expect(normal.code).toBe(0);
});
