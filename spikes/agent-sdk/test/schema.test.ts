import { describe, expect, it } from "vitest";
import { z } from "zod";
import { resultSchema } from "../src/schema.ts";

describe("resultSchema", () => {
  it("emits draft-07 and validates both directions", () => {
    expect(resultSchema.safeParse({ summary: "ok", files: ["a.ts"], count: 1 }).success).toBe(true);
    expect(resultSchema.safeParse({ summary: "", files: [], count: 0 }).success).toBe(false);
    expect(resultSchema.safeParse({}).success).toBe(false);
    const json = z.toJSONSchema(resultSchema, { target: "draft-7" }) as any;
    expect(json.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(json.properties.summary.minLength).toBe(1);
    expect(json.properties.count.minimum).toBe(1);
  });
});
