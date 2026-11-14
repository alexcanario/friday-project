import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { receivePackArgs } from "../src/git-receive-pack-args.ts";

const FILE_URL = "file:///tmp/r.git";

let shAvailable = true;
try {
  execFileSync("sh", ["-c", "true"]);
} catch {
  shAvailable = false;
}

describe("receivePackArgs", () => {
  it("builds one --receive-pack argument for a file:// target", () => {
    expect(receivePackArgs("git", FILE_URL, ["a"])).toEqual([
      "--receive-pack='git' -c 'hook.a.enabled=false' receive-pack",
    ]);
  });

  it("switches off every hook in a single argument", () => {
    expect(receivePackArgs("git", FILE_URL, ["a", "b"])).toEqual([
      "--receive-pack='git' -c 'hook.a.enabled=false' -c 'hook.b.enabled=false' receive-pack",
    ]);
  });

  it("returns no argument without hooks or for an https target", () => {
    expect(receivePackArgs("git", FILE_URL, [])).toEqual([]);
    expect(receivePackArgs("git", "https://github.com/o/r.git", ["a"])).toEqual([]);
  });

  it("quotes single quotes and spaces in POSIX style", () => {
    expect(receivePackArgs("git", FILE_URL, ["x'y"])).toEqual([
      "--receive-pack='git' -c 'hook.x'\''y.enabled=false' receive-pack",
    ]);
    const [arg] = receivePackArgs("C:/Program Files/git/bin/git", FILE_URL, ["a"]);
    expect(arg?.startsWith("--receive-pack='C:/Program Files/git/bin/git' -c ")).toBe(true);
  });

  it.skipIf(!shAvailable)("round-trips through sh into the original words", () => {
    const [arg] = receivePackArgs("g it", FILE_URL, ["x'y"]);
    const text = (arg ?? "").slice("--receive-pack=".length);
    const script = `set -- ${text}; printf '%s\n' "$@"`;
    const out = execFileSync("sh", ["-c", script], { encoding: "utf8" });
    expect(out.trimEnd().split("\n")).toEqual(["g it", "-c", "hook.x'y.enabled=false", "receive-pack"]);
  });
});
