import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contractJsonSchema } from "../src/json-schema.ts";
import type { ContractKind } from "../src/validate.ts";

const kinds: ContractKind[] = [
  "qaReport",
  "reviewVerdict",
  "triage",
  "criteria",
  "workReport",
  "diagnosis",
];

const outFlag = process.argv.indexOf("--out");
const outArg = outFlag === -1 ? undefined : process.argv[outFlag + 1];
if (outFlag !== -1 && (outArg === undefined || outArg === "" || outArg.startsWith("-"))) {
  console.error("Uso: generate-schemas [--out <pasta>]");
  process.exit(1);
}
const outDir =
  outArg === undefined ? resolve(import.meta.dirname, "../../../contracts") : resolve(outArg);

mkdirSync(outDir, { recursive: true });
for (const kind of kinds) {
  const text = `${JSON.stringify(contractJsonSchema(kind), null, 2)}\n`;
  writeFileSync(resolve(outDir, `${kind}.schema.json`), text);
}
