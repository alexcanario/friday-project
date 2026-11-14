import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** True when this git runs config-defined hooks and lists `name` for `event`. */
export function configHooksSupported(event: string, name: string, gitBin = "git"): boolean {
  let dir: string | undefined;
  try {
    dir = mkdtempSync(join(tmpdir(), "friday-hook-probe-"));
    const run = (...args: string[]): string =>
      execFileSync(gitBin, args, { cwd: dir, encoding: "utf8", stdio: "pipe" });
    run("init", "-q");
    run("config", `hook.${name}.event`, event);
    run("config", `hook.${name}.command`, "true");
    return run("hook", "list", event).includes(name);
  } catch {
    return false;
  } finally {
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** Skips the test, or fails it when `FRIDAY_REQUIRE_CONFIG_HOOKS=1` (CI), if hooks are unsupported. */
export function requireConfigHooks(
  supported: boolean,
  skip: () => void,
  env: Record<string, string | undefined> = process.env,
): void {
  if (supported) return;
  if (env.FRIDAY_REQUIRE_CONFIG_HOOKS === "1") {
    throw new Error(
      "FRIDAY_REQUIRE_CONFIG_HOOKS=1, mas este git não lista hooks de config em git hook list",
    );
  }
  skip();
}
