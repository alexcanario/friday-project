import { z } from "zod";
import { qaReportSchema, type QaReport } from "./qa-report.ts";
import { criteriaSchema, type Criteria } from "./criteria.ts";
import { diagnosisSchema, type Diagnosis } from "./diagnosis.ts";
import { triageSchema, type Triage } from "./triage.ts";
import { workReportSchema, type WorkReport } from "./work-report.ts";
import { reviewVerdictSchema, type ReviewVerdict } from "./review-verdict.ts";
import {
  violation,
  type ValidationResult,
  type Violation,
  type ViolationCode,
} from "./violation.ts";

interface ContractMap {
  qaReport: QaReport;
  reviewVerdict: ReviewVerdict;
  triage: Triage;
  criteria: Criteria;
  workReport: WorkReport;
  diagnosis: Diagnosis;
}

export type ContractKind = keyof ContractMap;

export const contractSchemas: Record<ContractKind, z.ZodType> = {
  qaReport: qaReportSchema,
  reviewVerdict: reviewVerdictSchema,
  triage: triageSchema,
  criteria: criteriaSchema,
  workReport: workReportSchema,
  diagnosis: diagnosisSchema,
};
const schemas = contractSchemas;

const join = (path: PropertyKey[]) => path.map(String).join(".");

function keyMissing(root: unknown, path: PropertyKey[]): boolean {
  let current: unknown = root;
  for (const [index, key] of path.entries()) {
    if (typeof current !== "object" || current === null) return false;
    if (index === path.length - 1) return !Object.hasOwn(current, key);
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return false;
}

function fromIssue(root: unknown, issue: z.core.$ZodIssue): Violation[] {
  const path = join(issue.path);
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((k) => violation("unknown_field", join([...issue.path, k])));
  }
  if (issue.code === "custom") {
    const code = (issue.params as { code?: ViolationCode } | undefined)?.code;
    return [violation(code ?? "invalid_value", path)];
  }
  if (path === "") return [violation("schema_invalid", "")];
  if (keyMissing(root, issue.path)) return [violation("required_field", path)];
  return [violation("invalid_value", path)];
}

export function validateContract<K extends ContractKind>(
  kind: K,
  value: unknown,
): ValidationResult<ContractMap[K]> {
  const schema = Object.hasOwn(schemas, kind) ? schemas[kind] : undefined;
  if (schema === undefined) {
    return { ok: false, violations: [violation("unknown_kind", "kind", String(kind))] };
  }
  const result = schema.safeParse(value);
  if (result.success) return { ok: true, value: result.data as ContractMap[K] };
  return { ok: false, violations: result.error.issues.flatMap((issue) => fromIssue(value, issue)) };
}

export function parseAndValidateContract<K extends ContractKind>(
  kind: K,
  text: string,
): ValidationResult<ContractMap[K]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, violations: [violation("json_invalid", "")] };
  }
  return validateContract(kind, parsed);
}
