import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "spike-repo-"));
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "t@example.com");
  git("config", "user.name", "t");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "hello.txt"), "hello");
  git("add", ".");
  git("commit", "-q", "-m", "init");
  return dir;
}

export function makeTmp(prefix = "spike-tmp-"): string {
  return mkdtempSync(join(tmpdir(), prefix));
}
