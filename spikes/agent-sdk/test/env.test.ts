import { describe, expect, it } from "vitest";
import { buildEnv } from "../src/env.ts";

describe("buildEnv", () => {
  it("keeps only allowlisted and extra keys", () => {
    expect(
      buildEnv({
        ANTHROPIC_API_KEY: "k",
        PATH: "/bin",
        AWS_SECRET_ACCESS_KEY: "x",
        GITHUB_TOKEN: "y",
      }),
    ).toEqual({ ANTHROPIC_API_KEY: "k", PATH: "/bin" });
    expect(buildEnv({})).toEqual({});
    expect(buildEnv({ PATH: undefined, ANTHROPIC_API_KEY: "k" })).toEqual({
      ANTHROPIC_API_KEY: "k",
    });
    expect(buildEnv({ TEMP: "/t", PATH: "/bin", X: "1" }, ["TEMP"])).toEqual({
      TEMP: "/t",
      PATH: "/bin",
    });
  });
});
