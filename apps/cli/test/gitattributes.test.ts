import { execFileSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readText, root } from "./helpers.js";

const fixture = "packages/infrastructure/test/fixtures/valid/factory.yaml";
const dirs: string[] = [];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}

function checkoutBytes(withAttributes: boolean): string {
  const dir = mkdtempSync(join(tmpdir(), "friday-eol-"));
  dirs.push(dir);
  git(dir, "init", "-q");
  git(dir, "config", "core.autocrlf", "true");
  copyFileSync(join(root, fixture), join(dir, "factory.yaml"));
  const files = ["factory.yaml"];
  if (withAttributes) {
    copyFileSync(join(root, ".gitattributes"), join(dir, ".gitattributes"));
    files.push(".gitattributes");
  }
  git(dir, "add", ...files);
  git(dir, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "init");
  rmSync(join(dir, "factory.yaml"));
  git(dir, "checkout", "--", "factory.yaml");
  return readFileSync(join(dir, "factory.yaml"), "utf8");
}

afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("gitattributes", () => {
  it("root gitattributes forces LF with text=auto", () => {
    expect(existsSync(join(root, ".gitattributes"))).toBe(true);
    expect(readText(".gitattributes").split(/\r?\n/)).toContain("* text=auto eol=lf");
  });

  it("git check-attr reports text auto and eol lf for the valid fixture", () => {
    const out = git(root, "check-attr", "text", "eol", "--", fixture);
    expect(out.trim().split(/\r?\n/)).toEqual([`${fixture}: text: auto`, `${fixture}: eol: lf`]);
  });

  it("checkout keeps LF in factory.yaml when autocrlf is true", () => {
    const text = checkoutBytes(true);
    expect(text).not.toContain("\r");
    expect(text).toContain("limits:\n");
  });

  it("checkout without gitattributes turns factory.yaml into CRLF when autocrlf is true", () => {
    const text = checkoutBytes(false);
    expect(text).toContain("limits:\r\n");
    expect(text).not.toContain("limits:\n");
  });
});
