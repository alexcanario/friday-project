import { FakeAgentRuntime, type AgentRuntime, type GitHubPort } from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { composeDaemon, type ComposeOptions } from "../src/index.ts";
import { AUTHOR_KEY, JUDGE_KEY } from "./compose-helpers.ts";
import { eventsOf, put, setup, stateOf } from "./compose-judge-helpers.ts";
import { finished, verdict } from "./judge-dispatch-helpers.ts";
import { FakeReviewer } from "./judge-fakes.ts";

const AUTHOR_APP = `  author_app:\n    app_id: 1\n    installation_id: 2\n    private_key_path: ${AUTHOR_KEY}\n`;
const REVIEW_APP = `  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: ${JUDGE_KEY}\n`;
const toApps = (y: string) =>
  y
    .replace("  author_token_env: FRIDAY_AUTHOR_TOKEN\n", AUTHOR_APP)
    .replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", REVIEW_APP);

type Provider = NonNullable<ComposeOptions["createTokenProvider"]>;

function withApps(
  judgeToken: () => Promise<string> = async () => "ghs_judge",
  runtime?: AgentRuntime,
) {
  const t = setup({ yaml: toApps, env: {}, ...(runtime === undefined ? {} : { runtime }) });
  const createTokenProvider = vi.fn<Provider>((input) => ({
    getToken: input.appId === 3 ? judgeToken : async () => "ghs_author",
  }));
  const createGitHubWithAuth = vi.fn(() => t.author as unknown as GitHubPort);
  t.opts.createTokenProvider = createTokenProvider;
  t.opts.createGitHubWithAuth =
    createGitHubWithAuth as unknown as ComposeOptions["createGitHubWithAuth"];
  return { ...t, createTokenProvider, createGitHubWithAuth };
}

async function tickJudge(t: ReturnType<typeof withApps>) {
  const daemon = await composeDaemon(t.opts);
  put(daemon, 7, "InReview");
  await daemon.ticker.tick();
  await daemon.ticker.idle();
  return daemon;
}

describe("composeDaemon with review_app", () => {
  it("composeDaemon posts the review with the friday-judge installation token", async () => {
    const t = withApps();
    const daemon = await tickJudge(t);
    expect(t.createTokenProvider).toHaveBeenCalledWith({
      appId: 3,
      installationId: 4,
      privateKeyPath: JUDGE_KEY,
      permissions: { pull_requests: "write" },
    });
    expect(t.opts.createGitHub).toHaveBeenCalledWith("ghs_judge", expect.anything());
    expect(t.opts.createGitHub).not.toHaveBeenCalledWith("ghs_author", expect.anything());
    expect(t.reviewers.map((r) => r.token)).toEqual(["ghs_judge"]);
    expect(t.reviewers[0]!.posted).toHaveLength(1);
    expect(stateOf(daemon, 7)).toBe("RiskCheck");
  });

  it("composeDaemon keeps the env review token with review_token_env", async () => {
    const t = setup({ env: { FRIDAY_AUTHOR_TOKEN: "t0k3n", FRIDAY_REVIEW_TOKEN: "jud9e" } });
    const createTokenProvider = vi.fn<Provider>(() => ({ getToken: async () => "x" }));
    t.opts.createTokenProvider = createTokenProvider;
    const daemon = await composeDaemon(t.opts);
    put(daemon, 7, "InReview");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(t.reviewers.map((r) => r.token)).toEqual(["jud9e"]);
    expect(createTokenProvider).not.toHaveBeenCalledWith(expect.objectContaining({ appId: 3 }));
  });

  it("composeDaemon reuses the review token provider across judge runs", async () => {
    const twice = new FakeAgentRuntime([finished(verdict()), finished(verdict())]);
    const t = withApps(undefined, twice);
    const daemon = await tickJudge(t);
    expect(eventsOf(daemon, "RunFinished")).toHaveLength(1);
    put(daemon, 7, "InReview");
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    expect(eventsOf(daemon, "RunFinished")).toHaveLength(2);
    const calls = t.createTokenProvider.mock.calls.filter(([i]) => i.appId === 3);
    expect(calls).toHaveLength(1);
  });

  it("composeDaemon never logs the review installation token", async () => {
    const t = withApps();
    const daemon = await composeDaemon(t.opts);
    put(daemon, 7, "InReview");
    const post = vi
      .spyOn(FakeReviewer.prototype, "postReview")
      .mockRejectedValue(new Error("401 ghs_abc123DEF"));
    await daemon.ticker.tick();
    await daemon.ticker.idle();
    post.mockRestore();
    const text = t.logs.join("\n");
    expect(text).toContain("Falha no Judge da issue 7:");
    expect(text).not.toContain("ghs_abc123DEF");
    expect(stateOf(daemon, 7)).toBe("InReview");
  });

  it("composeDaemon logs a review token failure and keeps InReview", async () => {
    const t = withApps(() => Promise.reject(new Error("falha na renovação")));
    const daemon = await tickJudge(t);
    expect(t.logs.join("\n")).toContain("Falha no Judge da issue 7: falha na renovação");
    expect(t.reviewers.flatMap((r) => r.posted)).toHaveLength(0);
    expect(stateOf(daemon, 7)).toBe("InReview");
  });
});
