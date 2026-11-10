import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createGitHubClientWithAuth, createInstallationTokenProvider } from "../src/index.ts";

const T0 = Date.UTC(2026, 0, 1);

function recordingFetch(respond: (n: number) => Response): {
  fetch: typeof fetch;
  authorizations: string[];
} {
  const authorizations: string[] = [];
  const f = (async (input: Request | URL | string, init?: RequestInit) => {
    const req = input instanceof Request ? input : undefined;
    authorizations.push(new Headers(req?.headers ?? init?.headers).get("authorization") ?? "");
    return respond(authorizations.length);
  }) as typeof fetch;
  return { fetch: f, authorizations };
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

describe("createGitHubClientWithAuth", () => {
  it("github client uses the renewed token after expiry", async () => {
    const dir = mkdtempSync(join(tmpdir(), "ghc-auth-"));
    const keyPath = join(dir, "k.pem");
    const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
    writeFileSync(keyPath, rsa.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
    const clock = { t: T0 };
    const tokens = recordingFetch((n) =>
      json({ token: `tok-${n}`, expires_at: new Date(clock.t + 3600_000).toISOString() }, 201),
    );
    const provider = createInstallationTokenProvider({
      appId: 1,
      installationId: 2,
      privateKeyPath: keyPath,
      now: () => clock.t,
      fetch: tokens.fetch,
    });
    const api = recordingFetch(() => json({ login: "friday" }));
    const octokit = createGitHubClientWithAuth(() => provider.getToken(), api.fetch);
    await octokit.request("GET /user");
    clock.t = T0 + 3400_000;
    await octokit.request("GET /user");
    expect(api.authorizations).toEqual(["token tok-1", "token tok-2"]);
  });

  it("github client rejects an empty token without calling fetch", async () => {
    for (const value of ["", "   "]) {
      const api = recordingFetch(() => json({}));
      const octokit = createGitHubClientWithAuth(async () => value, api.fetch);
      await expect(octokit.request("GET /user")).rejects.toThrow(/token/i);
      expect(api.authorizations).toHaveLength(0);
    }
  });
});
