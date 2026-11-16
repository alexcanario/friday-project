import { generateKeyPairSync } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FakeAgentRuntime, type GitHubPort } from "@friday/application";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createJudgeBranch } from "../src/judge-wiring.ts";
import { createRunRecorder } from "../src/run-recorder.ts";
import { fixture } from "./compose-helpers.ts";
import { FakeEvents, FakeIssueRepository, FakeRunRepository, slackBudget } from "./fakes.ts";
import { A, agents, finished, seedJudgeContext, verdict } from "./judge-dispatch-helpers.ts";
import { FakeCiGitHub } from "./judge-fakes.ts";

afterEach(() => vi.unstubAllGlobals());

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "friday-jte-"));
  const root = join(dir, "root");
  cpSync(fixture, root, { recursive: true });
  const keyPath = join(dir, "key.pem");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  writeFileSync(keyPath, privateKey);
  const file = join(root, "factory.yaml");
  const app = `  review_app:\n    app_id: 3\n    installation_id: 4\n    private_key_path: ${keyPath}\n`;
  const yaml = readFileSync(file, "utf8");
  const edited = yaml.replace("  review_token_env: FRIDAY_REVIEW_TOKEN\n", app);
  if (edited === yaml) throw new Error("fixture sem review_token_env");
  writeFileSync(file, edited);
  const now = () => new Date("2026-11-05T03:00:00.000Z");
  const events = new FakeEvents();
  seedJudgeContext(events, 7, A);
  const recorder = { projectId: "p", events, issues: new FakeIssueRepository(events), now };
  const github = new FakeCiGitHub();
  github.issues.push({ number: 7, title: "t", body: "", labels: ["friday"] });
  const runtime = new FakeAgentRuntime([finished(verdict())]);
  const postReview = vi.fn(async () => ({ id: 1 }));
  const reviewerFor = vi.fn((_token: string) => ({ postReview }));
  const logs: string[] = [];
  const { budget } = slackBudget(recorder);
  const branch = createJudgeBranch({
    projectId: "p",
    root,
    github: github as unknown as GitHubPort,
    reviewerFor,
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
    log: (m) => logs.push(m),
  });
  return { branch, runtime, reviewerFor, postReview, logs };
}

describe("createJudgeBranch token exchange", () => {
  it("createJudgeBranch posts pull_requests write to access_tokens", async () => {
    const calls: Array<{ url: string; method: string; body: string }> = [];
    vi.stubGlobal("fetch", async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? "GET", body: String(init?.body) });
      return Response.json({ token: "ghs_x", expires_at: "2099-01-01T00:00:00Z" }, { status: 201 });
    });
    const { branch, reviewerFor } = setup();
    await branch(7);
    const posts = calls.filter(
      (c) => c.method === "POST" && c.url.endsWith("/app/installations/4/access_tokens"),
    );
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0]!.body)).toEqual({ permissions: { pull_requests: "write" } });
    expect(reviewerFor).toHaveBeenCalledWith("ghs_x");
  });

  it("createJudgeBranch posts no review when the token exchange fails", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ message: "Forbidden" }, { status: 403 }));
    const { branch, runtime, postReview, logs } = setup();
    await expect(branch(7)).resolves.toEqual({ applied: false, feedback: null });
    const log = logs.join("\n");
    expect(log).toContain(
      "Falha no Judge da issue 7: Falha ao obter o token de instalação do App (HTTP 403).",
    );
    expect(log).not.toContain("ghs_");
    expect(runtime.requests).toHaveLength(0);
    expect(postReview).not.toHaveBeenCalled();
  });
});
