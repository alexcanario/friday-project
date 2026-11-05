import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

it("execa is pinned to 10.2.1", () => {
  const pkg = JSON.parse(readFileSync(resolve(import.meta.dirname, "../package.json"), "utf8"));
  expect(pkg.dependencies.execa).toBe("10.2.1");
});
