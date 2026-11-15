import { describe, expect, it } from "vitest";
import { projectFromSearch } from "../src/project-param.ts";

describe("projectFromSearch", () => {
  it("reads the project from the query string", () => {
    expect(projectFromSearch("?project=alexcanario/friday-project")).toBe(
      "alexcanario/friday-project",
    );
  });

  it("decodes the value and ignores other params", () => {
    expect(projectFromSearch("?project=a%2Fb&run=r1")).toBe("a/b");
  });

  it("returns undefined when project is absent or empty", () => {
    expect(projectFromSearch("")).toBeUndefined();
    expect(projectFromSearch("?")).toBeUndefined();
    expect(projectFromSearch("?project=")).toBeUndefined();
    expect(projectFromSearch("?run=r1")).toBeUndefined();
  });
});
