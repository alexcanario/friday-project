import { z } from "zod";
import { qaReportSchema, type QaReport } from "./qa-report.ts";
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
}

export type ContractKind = keyof ContractMap;

const schemas: Record<ContractKind, z.ZodType> = {
  qaReport: qaReportSchema,
  reviewVerdict: reviewVerdictSchema,
};

const join = (path: PropertyKey[]) => path.map(String).join(".");

function fromIssue(issue: z.core.$ZodIssue): Violation[] {
  const path = join(issue.path);
  if (issue.code === "unrecognized_keys") {
    return issue.keys.map((k) => violation("unknown_field", join([...issue.path, k])));
  }
  if (issue.code === "custom") {
    const code = (issue.params as { code?: ViolationCode } | undefined)?.code;
    return [violation(code ?? "invalid_value", path)];
  }
  if (issue.code === "invalid_type") {
    if (path === "") return [violation("schema_invalid", "")];
    const missing = issue.message.includes("received undefined");
    return [violation(missing ? "required_field" : "invalid_value", path)];
  }
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
  return { ok: false, violations: result.error.issues.flatMap(fromIssue) };
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
