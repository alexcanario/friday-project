import { describe, expect, it, vi } from "vitest";
import type { GitHost, GitHubPort } from "@friday/application";
import type { GitCliHostOptions } from "@friday/infrastructure";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { readAuthor } from "../src/compose-config.ts";
import { AUTHOR_KEY, JUDGE_KEY, setup } from "./compose-helpers.ts";
import { FakeGitHub } from "./fakes.ts";

const APP = `  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: ${AUTHOR_KEY}\n`;
const REVIEW_APP = `  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: ${JUDGE_KEY}\n`;
const REVIEW_ENV = "  review_token_env: FRIDAY_REVIEW_TOKEN\n";
const toApp = (y: string) => y.replace("  author_token_env: FRIDAY_AUTHOR_TOKEN\n", APP);

function withApp(edit: (y: string) => string = toApp) {
  const t = setup(edit);
  const getToken = vi.fn(async () => "tok-1");
  const createTokenProvider = vi.fn<NonNullable<ComposeOptions["createTokenProvider"]>>(() => ({
    getToken,
  }));
  const createGitHubWithAuth = vi.fn<NonNullable<ComposeOptions["createGitHubWithAuth"]>>(
    () => new FakeGitHub() as unknown as GitHubPort,
  );
  const gitHostOptions: GitCliHostOptions[] = [];
  const opts = {
    ...t.opts,
    env: {},
    createTokenProvider,
    createGitHubWithAuth,
    createGitHost: (o: GitCliHostOptions) => {
      gitHostOptions.push(o);
      return { push: vi.fn() } as unknown as GitHost;
    },
  };
  return { ...t, opts, createTokenProvider, createGitHubWithAuth, gitHostOptions };
}

describe("composeDaemon with author_app", () => {
  it("composeDaemon takes the token from the installation provider", async () => {
    const t = withApp();
    const daemon = await composeDaemon(t.opts);
    daemon.release();
    expect(t.createTokenProvider).toHaveBeenCalledWith({
      appId: 1,
      installationId: 2,
      privateKeyPath: AUTHOR_KEY,
    });
    expect(t.createGitHubWithAuth).toHaveBeenCalledTimes(1);
    const auth = t.createGitHubWithAuth.mock.calls[0]![0];
    expect(await auth()).toBe("tok-1");
    expect(t.createGitHub).not.toHaveBeenCalled();
    const other = withApp();
    const again = await composeDaemon({ ...other.opts, env: { FRIDAY_AUTHOR_TOKEN: "x" } });
    again.release();
    expect(other.createGitHub).not.toHaveBeenCalled();
  });

  it("author provider is created without permissions", async () => {
    const t = withApp();
    (await composeDaemon(t.opts)).release();
    expect(t.createTokenProvider).toHaveBeenCalledWith(
      expect.not.objectContaining({ permissions: expect.anything() }),
    );
    expect(t.createTokenProvider.mock.calls[0]![0]).toEqual({
      appId: 1,
      installationId: 2,
      privateKeyPath: AUTHOR_KEY,
    });
  });

  it("composeDaemon gives the git host a token function with author_app", async () => {
    const t = withApp();
    (await composeDaemon(t.opts)).release();
    const options = t.gitHostOptions[0]!;
    expect(typeof options.token).toBe("function");
    expect(await options.token!()).toBe("tok-1");
    expect("tokenEnv" in options).toBe(false);

    const env = setup();
    const gitHostOptions: GitCliHostOptions[] = [];
    const createGitHubWithAuth = vi.fn();
    const daemon = await composeDaemon({
      ...env.opts,
      createGitHubWithAuth,
      createGitHost: (o) => {
        gitHostOptions.push(o);
        return { push: vi.fn() } as unknown as GitHost;
      },
    });
    daemon.release();
    expect(gitHostOptions[0]?.tokenEnv).toBe("FRIDAY_AUTHOR_TOKEN");
    expect(gitHostOptions[0]).not.toHaveProperty("token");
    expect(createGitHubWithAuth).not.toHaveBeenCalled();
    expect(env.createGitHub).toHaveBeenCalledWith("t0k3n", expect.anything());
  });
});

describe("readAuthor", () => {
  it("readAuthor returns the discriminated union", () => {
    const app = readAuthor(setup((y) => toApp(y).replace(REVIEW_ENV, REVIEW_APP)).opts);
    expect(app).toMatchObject({
      mode: "app",
      app: { appId: 1, installationId: 2, privateKeyPath: AUTHOR_KEY },
      tokenEnvNames: [],
    });
    const judge = readAuthor(
      setup((y) => toApp(y).replace(REVIEW_ENV, "  review_token_env: FRIDAY_JUDGE_TOKEN\n")).opts,
    );
    expect(judge.tokenEnvNames).toEqual(["FRIDAY_JUDGE_TOKEN"]);
    const env = readAuthor(setup().opts);
    expect(env).toMatchObject({
      mode: "env",
      token: "t0k3n",
      tokenEnv: "FRIDAY_AUTHOR_TOKEN",
    });
    const missing = setup().opts;
    expect(() => readAuthor({ ...missing, env: {} })).toThrow(
      new Error("A variável FRIDAY_AUTHOR_TOKEN está vazia ou ausente."),
    );
  });

  it("rejects author_app without review credential", async () => {
    const t = setup((y) => toApp(y).replace(REVIEW_ENV, ""));
    await expect(composeDaemon({ ...t.opts, env: {} })).rejects.toThrow(
      "O factory.yaml está inválido ou ausente.",
    );
  });
});
