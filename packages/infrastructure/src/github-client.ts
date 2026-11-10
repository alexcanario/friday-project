import { Octokit } from "octokit";

export function createGitHubClient(token: string): Octokit {
  if (token.trim() === "") throw new Error("token de revisão vazio");
  return new Octokit({ auth: token });
}

/** Client that asks `auth` for the token on every request, so renewals reach it (D89). */
export function createGitHubClientWithAuth(
  auth: () => Promise<string>,
  fetchImpl: typeof fetch = globalThis.fetch,
): Octokit {
  const octokit = new Octokit({ request: { fetch: fetchImpl } });
  octokit.hook.before("request", async (options) => {
    const token = await auth();
    if (token.trim() === "") throw new Error("O token de autenticação do GitHub está vazio.");
    options.headers.authorization = `token ${token}`;
  });
  return octokit;
}
