import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { configHooksSupported, requireConfigHooks } from "./config-hooks-support.ts";

const FLAG = "FRIDAY_REQUIRE_CONFIG_HOOKS";

describe("requireConfigHooks", () => {
  it("does nothing when hooks are supported", () => {
    const skip = vi.fn();
    expect(() => requireConfigHooks(true, skip, {})).not.toThrow();
    expect(() => requireConfigHooks(true, skip, { [FLAG]: "1" })).not.toThrow();
    expect(skip).not.toHaveBeenCalled();
  });

  it("skips when unsupported and the flag is unset", () => {
    const skip = vi.fn();
    expect(() => requireConfigHooks(false, skip, {})).not.toThrow();
    expect(skip).toHaveBeenCalledTimes(1);
  });

  it("throws when unsupported and the flag is 1", () => {
    const skip = vi.fn();
    let error: unknown;
    try {
      requireConfigHooks(false, skip, { [FLAG]: "1" });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain(FLAG);
    expect((error as Error).message).toContain("git hook list");
    expect(skip).not.toHaveBeenCalled();
  });

  it("treats 0 and empty as unset", () => {
    for (const value of ["0", ""]) {
      const skip = vi.fn();
      expect(() => requireConfigHooks(false, skip, { [FLAG]: value })).not.toThrow();
      expect(skip).toHaveBeenCalledTimes(1);
    }
  });
});

describe("configHooksSupported", () => {
  it("configHooksSupported returns false for a missing git", () => {
    expect(configHooksSupported("reference-transaction", "probe", "friday-no-such-git")).toBe(
      false,
    );
  });

  it("configHooksSupported is true when the flag is 1", () => {
    const result = configHooksSupported("reference-transaction", "probe");
    if (process.env[FLAG] === "1") expect(result).toBe(true);
    else expect(typeof result).toBe("boolean");
  });
});

describe("hook test files", () => {
  const files = [
    "git-cli-host-config-hooks.test.ts",
    "git-worktree-manager-context.test.ts",
    "git-worktree-hooks-env.test.ts",
    "git-worktree-manager-protected.test.ts",
  ];

  it("hook tests use the shared helper", () => {
    for (const file of files) {
      const text = readFileSync(resolve(import.meta.dirname, file), "utf8");
      expect(text, file).toContain("requireConfigHooks(");
      expect(text, file).toContain("./config-hooks-support.ts");
      expect(text, file).not.toContain("function supportsConfigHooks");
      expect(text, file).not.toContain("function listsHook");
      for (const line of text.split("\n")) {
        if (line.includes("configHooksSupported") && line.includes("skip()")) {
          expect(line, file).toContain("requireConfigHooks(");
        }
        if (line.includes("skip()")) {
          expect(
            line.includes("requireConfigHooks(") || line.includes('existsSync(marker("up"))'),
            `${file}: ${line.trim()}`,
          ).toBe(true);
        }
      }
    }
  });
});
