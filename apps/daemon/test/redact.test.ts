import { describe, expect, it, vi } from "vitest";
import { createRedactor, withRedactedLog } from "../src/redact.ts";

describe("createRedactor", () => {
  it("replaces the values of the three token variables with *** ", () => {
    const redact = createRedactor({
      FRIDAY_AUTHOR_TOKEN: "t0k3n",
      FRIDAY_JUDGE_TOKEN: "j7dg3",
      ANTHROPIC_API_KEY: "k3y-xyz",
    });
    expect(redact("a t0k3n b j7dg3 c k3y-xyz t0k3n")).toBe("a *** b *** c *** ***");
  });

  it("leaves messages without secrets unchanged and ignores empty values", () => {
    const redact = createRedactor({ FRIDAY_AUTHOR_TOKEN: "t0k3n" });
    expect(redact("Failed to list issues: falha")).toBe("Failed to list issues: falha");
    expect(redact("")).toBe("");
    expect(createRedactor({})("abc")).toBe("abc");
    expect(createRedactor({ FRIDAY_AUTHOR_TOKEN: "" })("abc")).toBe("abc");
  });

  it("redacts github_pat_, ghs_ and sk-ant- patterns only on word boundary", () => {
    const redact = createRedactor({});
    expect(redact("x github_pat_AbC123_def y")).toBe("x *** y");
    expect(redact("tok ghs_AbC123 fim")).toBe("tok *** fim");
    expect(redact("k sk-ant-api03-AbC_d-e fim")).toBe("k *** fim");
    expect(redact("nonghs_abc")).toBe("nonghs_abc");
  });

  it("replaces tokens with regex metacharacters literally", () => {
    const redact = createRedactor({ FRIDAY_AUTHOR_TOKEN: "a.b*c(" });
    expect(redact("x a.b*c( y aXb")).toBe("x *** y aXb");
  });
});

describe("createRedactor with tokenEnvNames", () => {
  it("masks the value of a variable named in tokenEnvNames", () => {
    expect(createRedactor({ MEU_TOKEN: "valor-secreto" }, ["MEU_TOKEN"])("x valor-secreto y")).toBe(
      "x *** y",
    );
  });

  it("ignores unlisted, absent and empty named variables", () => {
    expect(createRedactor({ MEU_TOKEN: "valor-secreto" })("x valor-secreto y")).toBe(
      "x valor-secreto y",
    );
    expect(createRedactor({}, ["MEU_TOKEN"])("abc")).toBe("abc");
    expect(createRedactor({ MEU_TOKEN: "" }, ["MEU_TOKEN"])("abc")).toBe("abc");
  });

  it("redacts gh[pousr]_ prefixes", () => {
    const redact = createRedactor({});
    for (const p of ["ghp", "gho", "ghu", "ghr", "ghs"]) expect(redact(`a ${p}_x`)).toBe("a ***");
  });

  it("keeps non-token words with gh prefixes unchanged", () => {
    const redact = createRedactor({});
    for (const t of ["nonghp_abc", "ghx_abc", "ghp_"]) expect(redact(t)).toBe(t);
  });
});

describe("withRedactedLog", () => {
  it("withRedactedLog masks the names passed in tokenEnvNames", () => {
    const log = vi.fn();
    withRedactedLog({ env: { MEU_TOKEN: "valor-secreto" }, log }, ["MEU_TOKEN"]).log?.(
      "Bearer valor-secreto",
    );
    expect(log).toHaveBeenLastCalledWith("Bearer ***");
    withRedactedLog({ env: { MEU_TOKEN: "valor-secreto" }, log }).log?.("Bearer valor-secreto");
    expect(log).toHaveBeenLastCalledWith("Bearer valor-secreto");
  });

  it("wraps log and keeps log undefined when absent", () => {
    const log = vi.fn();
    const wrapped = withRedactedLog({ env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" }, log });
    wrapped.log?.("Bearer t0k3n");
    expect(log).toHaveBeenCalledWith("Bearer ***");

    const bare = withRedactedLog({ env: { FRIDAY_AUTHOR_TOKEN: "t0k3n" } });
    expect("log" in bare).toBe(false);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
