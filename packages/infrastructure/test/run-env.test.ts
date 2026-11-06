import { describe, expect, it } from "vitest";
import { buildRunEnv } from "../src/index.ts";

describe("buildRunEnv", () => {
  it("keeps only the allowed keys", () => {
    expect(
      buildRunEnv({
        ANTHROPIC_API_KEY: "a",
        PATH: "b",
        HOME: "c",
        GH_TOKEN: "d",
        GITHUB_TOKEN: "e",
        PROJECT_TOKEN: "f",
        TEMP: undefined,
      }),
    ).toStrictEqual({ ANTHROPIC_API_KEY: "a", PATH: "b", HOME: "c" });
    const win = { Path: "b", SystemRoot: "s", USERPROFILE: "u", TEMP: "t" };
    expect(buildRunEnv(win)).toStrictEqual(win);
  });

  it("keeps the author token out of the run", () => {
    const env = buildRunEnv({ PATH: "/bin", FRIDAY_AUTHOR_TOKEN: "segredo" });
    expect(env).not.toHaveProperty("FRIDAY_AUTHOR_TOKEN");
    expect(env).toHaveProperty("PATH");
  });
});
