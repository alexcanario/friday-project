import { describe, expect, it, vi } from "vitest";
import type { GitHost, GitHubPort } from "@friday/application";
import type { GitCliHostOptions } from "@friday/infrastructure";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { readAuthor } from "../src/compose-config.ts";
import { setup } from "./compose-helpers.ts";
import { FakeGitHub } from "./fakes.ts";

const APP =
  "  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: /etc/friday/author.pem\n";
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
      privateKeyPath: "/etc/friday/author.pem",
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
    const app = readAuthor(setup(toApp).opts);
    expect(app).toMatchObject({
      mode: "app",
      app: { appId: 1, installationId: 2, privateKeyPath: "/etc/friday/author.pem" },
      tokenEnvNames: [],
    });
    const judge = readAuthor(
      setup((y) =>
        toApp(y).replace(
          APP,
          `${APP}  review_token_env: FRIDAY_JUDGE_TOKEN
`,
        ),
      ).opts,
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
});
