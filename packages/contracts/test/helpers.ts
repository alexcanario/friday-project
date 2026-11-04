import { validateContract, type ContractKind } from "../src/validate.ts";

export const SHA = "a".repeat(40);

export function pairs(kind: ContractKind, value: unknown): string[] {
  const r = validateContract(kind, value);
  return r.ok ? [] : r.violations.map((v) => `${v.code}@${v.path}`).sort();
}
