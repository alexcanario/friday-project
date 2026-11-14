import { describe, expect, it } from "vitest";
import { loadFactoryConfig } from "../src/index.ts";
import { edit, makeRoot } from "./config-helpers.ts";

function rootWithPanel(port: number): string {
  const root = makeRoot();
  edit(root, "factory.yaml", (l) => [
    ...l.filter((x) => x !== ""),
    "panel:",
    `  port: ${port}`,
    "",
  ]);
  return root;
}

describe("factory.yaml panel", () => {
  it("loads panel.port and rejects an out-of-range port", () => {
    const ok = loadFactoryConfig(rootWithPanel(9000));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.config.panel?.port).toBe(9000);
    expect(loadFactoryConfig(rootWithPanel(70000)).ok).toBe(false);
  });
});
