import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { GitHubPort } from "@friday/application";
import { describe, expect, it, vi } from "vitest";
import { createJudgeBranch, readReviewCredential } from "../src/judge-wiring.ts";
import { createRunRecorder } from "../src/run-recorder.ts";
import { JUDGE_KEY, fixture } from "./compose-helpers.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, slackBudget } from "./fakes.ts";
import { agents } from "./judge-dispatch-helpers.ts";
import { CountingPendingRuntime, FakeCiGitHub } from "./judge-fakes.ts";

describe("createJudgeBranch", () => {
  it("returns not applied when the issue is not listed", async () => {
    const root = mkdtempSync(join(tmpdir(), "friday-jw-"));
    cpSync(fixture, root, { recursive: true });
    const now = () => new Date("2026-11-05T03:00:00.000Z");
    const events = new FakeEvents();
    const recorder = { projectId: "p", events, issues: new FakeIssueRepository(events), now };
    const runtime = new CountingPendingRuntime();
    const log = vi.fn<(m: string) => void>();
    const github = new FakeCiGitHub();
    const { budget } = slackBudget(recorder);
    const branch = createJudgeBranch({
      projectId: "p",
      root,
      github: github as unknown as GitHubPort,
      reviewerFor: () => ({ postReview: () => Promise.resolve({ id: 1 }) }),
      compose: {
        base: "main",
        agents: agents(),
        input: () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" }),
      },
      env: { FRIDAY_REVIEW_TOKEN: "jud9e" },
      runtime,
      prOf: () => 30,
      recorder,
      recording: { runs: new FakeRunRepository(), recorder: createRunRecorder(recorder) },
      budget,
      now,
      log,
    });
    await expect(branch(7)).resolves.toEqual({ applied: false, feedback: null });
    expect(runtime.calls).toBe(0);
    expect(log.mock.calls.map((c) => c[0]).join("\n")).toContain("Falha no Judge da issue 7:");
  });
});

const APP = `  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: ${JUDGE_KEY}\n`;

function rootWith(edit: (y: string) => string = (y) => y): string {
  const root = mkdtempSync(join(tmpdir(), "friday-jw-"));
  cpSync(fixture, root, { recursive: true });
  const file = join(root, "factory.yaml");
  writeFileSync(file, edit(readFileSync(file, "utf8")));
  return root;
}

describe("readReviewCredential", () => {
  it("readReviewCredential maps review_app and review_token_env and returns null for a bad config", async () => {
    const getToken = vi.fn(async () => "x");
    const providerFor = vi.fn(() => ({ getToken }));
    const app = rootWith((y) => y.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", APP));
    const cred = readReviewCredential(app, providerFor);
    expect(cred?.mode).toBe("app");
    expect(providerFor).toHaveBeenCalledWith({
      appId: 3,
      installationId: 4,
      privateKeyPath: JUDGE_KEY,
      permissions: { pull_requests: "write" },
    });
    if (cred?.mode === "app") await expect(cred.getToken()).resolves.toBe("x");

    providerFor.mockClear();
    expect(readReviewCredential(rootWith(), providerFor)).toEqual({
      mode: "env",
      tokenEnv: "FRIDAY_REVIEW_TOKEN",
    });
    expect(
      readReviewCredential(
        rootWith(() => "not: [valid"),
        providerFor,
      ),
    ).toBeNull();
    const missing = rootWith();
    rmSync(join(missing, "factory.yaml"));
    expect(readReviewCredential(missing, providerFor)).toBeNull();
    expect(providerFor).not.toHaveBeenCalled();
  });

  it("readReviewCredential asks the review App only for pull_requests write", () => {
    const providerFor = vi.fn(() => ({ getToken: async () => "x" }));
    const app = rootWith((y) => y.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", APP));
    readReviewCredential(app, providerFor);
    expect(providerFor).toHaveBeenCalledTimes(1);
    expect(providerFor).toHaveBeenCalledWith({
      appId: 3,
      installationId: 4,
      privateKeyPath: JUDGE_KEY,
      permissions: { pull_requests: "write" },
    });
  });

  it("readReviewCredential does not create an App provider for review_token_env", () => {
    const providerFor = vi.fn(() => ({ getToken: async () => "x" }));
    expect(readReviewCredential(rootWith(), providerFor)).toEqual({
      mode: "env",
      tokenEnv: "FRIDAY_REVIEW_TOKEN",
    });
    expect(providerFor).not.toHaveBeenCalled();
  });

  it("createJudgeBranch logs and skips when the factory.yaml is missing", async () => {
    const root = rootWith();
    rmSync(join(root, "factory.yaml"));
    const now = () => new Date("2026-11-05T03:00:00.000Z");
    const events = new FakeEvents();
    const recorder = { projectId: "p", events, issues: new FakeIssueRepository(events), now };
    const runtime = new CountingPendingRuntime();
    const log = vi.fn<(m: string) => void>();
    const createTokenProvider = vi.fn(() => ({ getToken: async () => "x" }));
    const { budget } = slackBudget(recorder);
    const branch = createJudgeBranch({
      projectId: "p",
      root,
      github: new FakeCiGitHub() as unknown as GitHubPort,
      reviewerFor: () => ({ postReview: () => Promise.resolve({ id: 1 }) }),
      compose: {
        base: "main",
        agents: agents(),
        input: () => ({ cwd: "/tmp/wt", prompt: "judge", configRoot: "/tmp/cfg" }),
      },
      env: {},
      runtime,
      prOf: () => 30,
      recorder,
      recording: { runs: new FakeRunRepository(), recorder: createRunRecorder(recorder) },
      budget,
      now,
      log,
      createTokenProvider,
    });
    await expect(branch(7)).resolves.toEqual({ applied: false, feedback: null });
    expect(runtime.calls).toBe(0);
    expect(createTokenProvider).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "Falha no Judge da issue 7: o factory.yaml está inválido ou ausente.",
    );
  });
});
