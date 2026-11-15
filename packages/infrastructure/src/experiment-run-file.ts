import { writeFileSync } from "node:fs";
import { experimentRunSchema, type ExperimentRun } from "@friday/contracts";

export function createExperimentRunFile(path: string): { append(run: ExperimentRun): void } {
  try {
    writeFileSync(path, "[]\n", { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      throw new Error(`Erro: o arquivo já existe: ${path}`, { cause: error });
    }
    throw error;
  }
  const runs: ExperimentRun[] = [];
  return {
    append(run) {
      const valid = experimentRunSchema.parse(run);
      runs.push(valid);
      writeFileSync(path, `${JSON.stringify(runs, null, 2)}\n`);
    },
  };
}
