import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHost, GitHubPort } from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { setup } from "./compose-helpers.ts";
import { FakeGitHub } from "./fakes.ts";

const keyDir = mkdtempSync(join(tmpdir(), "friday-keys-"));
const authorKey = join(keyDir, "author.pem");
const reviewKey = join(keyDir, "judge.pem");
writeFileSync(authorKey, "SEGREDO-NAO-PEM");
writeFileSync(reviewKey, "SEGREDO-NAO-PEM");
const missing = join(keyDir, "missing.pem");

const authorApp = (path: string) =>
  `  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: ${path}\n`;
const reviewApp = (path: string) =>
  `  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: ${path}\n`;

function withKeys(author: string, review?: string) {
  const t = setup((y) => {
    const a = y.replace("  author_token_env: FRIDAY_AUTHOR_TOKEN\n", authorApp(author));
    return review === undefined
      ? a
      : a.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", reviewApp(review));
  });
  const createTokenProvider = vi.fn<NonNullable<ComposeOptions["createTokenProvider"]>>(() => ({
    getToken: async () => "tok",
  }));
  const opts: ComposeOptions = {
    ...t.opts,
    env: review === undefined ? { FRIDAY_REVIEW_TOKEN: "r" } : {},
    createTokenProvider,
    createGitHubWithAuth: () => new FakeGitHub() as unknown as GitHubPort,
    createGitHost: () => ({ push: vi.fn() }) as unknown as GitHost,
  };
  return { ...t, opts, createTokenProvider };
}

function withEnvAuthor(review: string) {
  const t = setup((y) => y.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", reviewApp(review)));
  const opts: ComposeOptions = {
    ...t.opts,
    createTokenProvider: () => ({ getToken: async () => "tok" }),
    createGitHubWithAuth: () => new FakeGitHub() as unknown as GitHubPort,
    createGitHost: () => ({ push: vi.fn() }) as unknown as GitHost,
  };
  return { ...t, opts };
}

const lockPath = (root: string) => join(root, ".friday", "daemon.lock");

describe("composeDaemon private key check", () => {
  it("composeDaemon accepts a readable author key", async () => {
    const t = withKeys(authorKey);
    const daemon = await composeDaemon(t.opts);
    daemon.release();
    expect(t.createTokenProvider).toHaveBeenCalledWith({
      appId: 1,
      installationId: 2,
      privateKeyPath: authorKey,
    });
  });

  it("composeDaemon rejects a missing author key before lock and database", async () => {
    const t = withKeys(missing);
    await expect(composeDaemon(t.opts)).rejects.toThrow(
      new Error(`Não foi possível ler a chave privada de pull_requests.author_app em ${missing}.`),
    );
    expect(t.createTokenProvider).not.toHaveBeenCalled();
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(lockPath(t.root))).toBe(false);
  });

  it("composeDaemon rejects a missing review_app key", async () => {
    const t = withKeys(authorKey, missing);
    await expect(composeDaemon(t.opts)).rejects.toThrow(
      new Error(`Não foi possível ler a chave privada de pull_requests.review_app em ${missing}.`),
    );
    expect(existsSync(t.opts.dbPath)).toBe(false);
  });

  it("composeDaemon accepts both keys and skips the check with author_token_env", async () => {
    const both = withKeys(authorKey, reviewKey);
    (await composeDaemon(both.opts)).release();
    const env = setup();
    (await composeDaemon(env.opts)).release();
    expect(env.createGitHub).toHaveBeenCalledTimes(1);
  });

  it("composeDaemon rejects a missing review_app key with author_token_env before lock and database", async () => {
    const t = withEnvAuthor(missing);
    await expect(composeDaemon(t.opts)).rejects.toThrow(
      new Error(`Não foi possível ler a chave privada de pull_requests.review_app em ${missing}.`),
    );
    expect(existsSync(t.opts.dbPath)).toBe(false);
    expect(existsSync(lockPath(t.root))).toBe(false);
  });

  it("composeDaemon accepts a readable review_app key with author_token_env", async () => {
    const t = withEnvAuthor(reviewKey);
    const daemon = await composeDaemon(t.opts);
    daemon.release();
    expect(t.createGitHub).toHaveBeenCalledTimes(1);
  });

  it("composeDaemon rejects a review_app key that is a directory with author_token_env", async () => {
    const t = withEnvAuthor(keyDir);
    await expect(composeDaemon(t.opts)).rejects.toThrow(
      new Error(`Não foi possível ler a chave privada de pull_requests.review_app em ${keyDir}.`),
    );
  });
});
