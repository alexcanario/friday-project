import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runUntilSignal, setup, validRoot } from "./daemon-helpers.ts";

function rootWithToken(): string {
  const root = validRoot();
  const file = join(root, "factory.yaml");
  writeFileSync(
    file,
    readFileSync(file, "utf8").replace(
      "  author_token_env: FRIDAY_AUTHOR_TOKEN\n",
      "  author_token_env: MEU_TOKEN\n",
    ),
  );
  return root;
}

const env = () => ({ FRIDAY_HOME: rootWithToken(), MEU_TOKEN: "valor-secreto" });

describe("daemon error redaction", () => {
  it("redacts token values in the startDaemon compose error", async () => {
    const s = setup(env());
    s.compose.mockRejectedValue(new Error("falha com valor-secreto"));
    const { runDaemonCommand } = await import("../src/daemon.ts");
    expect(await runDaemonCommand(["daemon"], s.deps)).toEqual({
      stdout: "",
      stderr: "falha com ***\n",
      code: 1,
    });
  });

  it("redacts token values in the untilSignal error", async () => {
    const s = setup(env());
    s.idle.mockRejectedValue(new Error("falha com valor-secreto"));
    const r = await runUntilSignal(s);
    expect(r.stderr).toBe("falha com ***\n");
    expect(r.code).toBe(1);
    expect(s.release).toHaveBeenCalled();
  });

  it("keeps an error without secrets unchanged", async () => {
    const s = setup(env());
    s.compose.mockRejectedValue(new Error("falha comum"));
    const { runDaemonCommand } = await import("../src/daemon.ts");
    const r = await runDaemonCommand(["daemon"], s.deps);
    expect(r.stderr).toBe("falha comum\n");
    vi.restoreAllMocks();
  });
});
