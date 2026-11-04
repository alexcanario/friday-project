import { z } from "zod";
import { contractSchemas, type ContractKind } from "./validate.ts";

export function contractJsonSchema(kind: ContractKind): Record<string, unknown> {
  return z.toJSONSchema(contractSchemas[kind], { target: "draft-7", io: "input" });
}
