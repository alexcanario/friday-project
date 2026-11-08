import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { daemonPaths, projectIdOf } from "../src/daemon-values.ts";

const repository = { owner: "alexcanario", name: "friday-sandbox" };

describe("daemon values", () => {
  it("daemonPaths derives root, db and clone from FRIDAY_HOME or home", () => {
    const abs = join(import.meta.dirname, "central");
    expect(daemonPaths({ env: { FRIDAY_HOME: abs }, homeDir: "/h", repository })).toEqual({
      root: abs,
      dbPath: join(abs, "friday.db"),
      repoDir: join(abs, "repos", "alexcanario__friday-sandbox"),
    });
    for (const env of [{}, { FRIDAY_HOME: "" }]) {
      expect(daemonPaths({ env, homeDir: "/h", repository }).root).toBe(join("/h", ".friday"));
    }
  });

  it("projectIdOf joins owner and name", () => {
    expect(projectIdOf(repository)).toBe("alexcanario/friday-sandbox");
  });
});
