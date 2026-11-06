import { Octokit } from "octokit";

export function createGitHubClient(token: string): Octokit {
  if (token.trim() === "") throw new Error("token de revisão vazio");
  return new Octokit({ auth: token });
}
