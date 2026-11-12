import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createProductionOpen } from "../src/production-client.ts";

const fixture = join(import.meta.dirname, "../../../packages/infrastructure/test/fixtures/valid");
const ENV_LINE = "  author_token_env: FRIDAY_AUTHOR_TOKEN\n";
const tmp = (name: string) => mkdtempSync(join(tmpdir(), `friday-${name}-`));
const keyFile = join(tmp("key"), "author.pem");
writeFileSync(keyFile, "SEGREDO-NAO-PEM");
const missing = join(tmp("key"), "missing.pem");

function makeRoot(path: string): string {
  const dir = tmp("root");
  cpSync(fixture, dir, { recursive: true });
  const file = join(dir, "factory.yaml");
  const block = `  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: ${path}\n`;
  writeFileSync(file, readFileSync(file, "utf8").replace(ENV_LINE, block));
  return dir;
}

describe("friday approvals production client key check", () => {
  it("decide rejects a missing author key and accepts a readable one", async () => {
    const createTokenProvider = vi.fn(() => ({ getToken: async () => "tok" }));
    const open = (path: string) =>
      createProductionOpen({
        env: { FRIDAY_HOME: makeRoot(path) },
        homeDir: tmp("home"),
        createTokenProvider,
        createGitHubWithAuth: () => ({}) as never,
      });
    const dbPath = join(tmp("db"), "friday.db");
    await expect(open(missing)(dbPath).decide("00000001", "approve")).rejects.toThrow(
      new Error(`Não foi possível ler a chave privada de pull_requests.author_app em ${missing}.`),
    );
    expect(createTokenProvider).not.toHaveBeenCalled();
    expect(existsSync(dbPath)).toBe(false);
    const client = open(keyFile)(join(tmp("db"), "friday.db"));
    await client.decide("00000001", "approve").catch(() => undefined);
    client.close?.();
    expect(createTokenProvider).toHaveBeenCalledWith({
      appId: 1,
      installationId: 2,
      privateKeyPath: keyFile,
    });
  });
});
