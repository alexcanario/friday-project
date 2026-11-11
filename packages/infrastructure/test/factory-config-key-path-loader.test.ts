import { describe, expect, it } from "vitest";
import { loadFactoryConfig } from "../src/index.ts";
import { edit, makeRoot } from "./config-helpers.ts";

describe("factory.yaml private_key_path", () => {
  it("loads a Windows private_key_path from YAML", () => {
    const app = [
      "  author_app:",
      "    app_id: 1",
      "    installation_id: 2",
      String.raw`    private_key_path: 'C:\Users\alex\.friday\keys\author.pem'`,
    ];
    const root = makeRoot();
    edit(root, "factory.yaml", (l) => [...l.slice(0, 22), ...app, ...l.slice(23)]);
    const result = loadFactoryConfig(root);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.pull_requests.author_app?.private_key_path).toBe(
        "C:\Users\alex\.friday\keys\author.pem",
      );
    }
  });
});
