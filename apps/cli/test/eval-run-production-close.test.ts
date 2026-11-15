import { join } from "node:path";
import { readdirSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { openDatabase } from "@friday/infrastructure";
import { createProductionRunner, type ProductionInput } from "../src/eval-run-production.ts";
import { CLAIMS, fakes, removeWorkspaces, workspace } from "./eval-run-fakes.ts";

vi.mock("@friday/infrastructure", async (importOriginal) => {
  const real = await importOriginal<typeof import("@friday/infrastructure")>();
  return {
    ...real,
    openDatabase: vi.fn((path: string) => {
      const db = real.openDatabase(path);
      return {
        ...db,
        close: () => {
          db.close();
          throw new Error("boom close");
        },
      };
    }),
  };
});

afterEach(removeWorkspaces);

type Ws = ReturnType<typeof workspace>;

function inputOf(ws: Ws): ProductionInput {
  return {
    registryRoot: ws.registryRoot,
    env: ws.env,
    homeDir: join(ws.base, "user"),
    now: () => 1_000,
    criteriaById: new Map([["E1", CLAIMS]]),
  };
}

it("removes the temporary folder when db.close throws", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  const { close } = await createProductionRunner(inputOf(ws), f.seams);
  expect(readdirSync(ws.tmpRoot)).toHaveLength(1);
  expect(() => close()).toThrow("boom close");
  expect(readdirSync(ws.tmpRoot)).toEqual([]);
  expect(() => close()).not.toThrow();
});

it("keeps the open error and removes the temporary folder when openDatabase throws", async () => {
  const ws = workspace();
  const f = fakes(ws.tmpRoot);
  vi.mocked(openDatabase).mockImplementationOnce(() => {
    throw new Error("boom open");
  });
  await expect(createProductionRunner(inputOf(ws), f.seams)).rejects.toThrow("boom open");
  expect(readdirSync(ws.tmpRoot)).toEqual([]);
});
