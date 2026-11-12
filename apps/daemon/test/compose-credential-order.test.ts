import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { composeDaemon } from "../src/index.ts";
import { setup } from "./compose-helpers.ts";

const MESSAGE = "O factory.yaml está inválido ou ausente.";
const REVIEW_LINE = "  review_token_env: FRIDAY_REVIEW_TOKEN\n";
const withoutReview = (y: string) => y.replace(REVIEW_LINE, "");
const withBoth = (y: string) =>
  y.replace(
    REVIEW_LINE,
    `${REVIEW_LINE}  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: /etc/friday/judge.pem\n`,
  );
const lockOf = (root: string) => join(root, ".friday", "daemon.lock");

describe("credential check order", () => {
  it("refuses a config without review credential before database and lock", async () => {
    const t = setup(withoutReview);
    await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(MESSAGE));
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(lockOf(t.root))).toBe(false);
  });

  it("refuses review_app together with review_token_env before database and lock", async () => {
    const t = setup(withBoth);
    await expect(composeDaemon(t.opts)).rejects.toThrow(new Error(MESSAGE));
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(lockOf(t.root))).toBe(false);
  });

  it("never builds a GitHub client on either refusal", async () => {
    for (const edit of [withoutReview, withBoth]) {
      const t = setup(edit);
      await expect(composeDaemon(t.opts)).rejects.toThrow();
      expect(t.createGitHub).not.toHaveBeenCalled();
    }
  });

  it("creates database and lock for a valid config and removes the lock on release", async () => {
    const t = setup();
    const daemon = await composeDaemon(t.opts);
    expect(existsSync(t.opts.dbPath)).toBe(true);
    expect(existsSync(lockOf(t.root))).toBe(true);
    daemon.release();
    expect(existsSync(lockOf(t.root))).toBe(false);
  });
});
