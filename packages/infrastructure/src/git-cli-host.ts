import { execa } from "execa";
import type { GitHost } from "@friday/application";

const COMMIT = /^[0-9a-f]{40}$/;
const BRANCH = /^friday\/[0-9]+(-[a-z0-9-]+)?$/;
const STRIPPED_ENV = ["GIT_CONFIG_PARAMETERS", "GIT_ASKPASS", "GIT_CONFIG_GLOBAL"];

export interface GitCliHostOptions {
  tokenEnv: string;
  env?: Record<string, string | undefined>;
  gitBinary?: string;
  remote?: string;
}

export class GitCliHost implements GitHost {
  private readonly tokenEnv: string;
  private readonly env: Record<string, string | undefined>;
  private readonly gitBinary: string;
  private readonly remote: string;

  constructor(options: GitCliHostOptions) {
    if (options.tokenEnv.trim() === "") {
      throw new Error("O nome da variável de ambiente do token não pode ser vazio.");
    }
    this.tokenEnv = options.tokenEnv;
    this.env = options.env ?? process.env;
    this.gitBinary = options.gitBinary ?? "git";
    this.remote = options.remote ?? "origin";
  }

  async push(request: { worktree: string; branch: string; commit: string }): Promise<void> {
    const { worktree, branch, commit } = request;
    if (worktree.trim() === "") throw new Error("O worktree não pode ser vazio.");
    if (!COMMIT.test(commit))
      throw new Error("Commit inválido: esperado SHA de 40 hex minúsculos.");
    if (!BRANCH.test(branch)) throw new Error("Branch inválida: esperado friday/<n>[-slug].");
    const token = this.env[this.tokenEnv];
    if (token === undefined || token.trim() === "") {
      throw new Error(`A variável de ambiente ${this.tokenEnv} não está definida.`);
    }
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    const result = await execa(
      this.gitBinary,
      ["push", "--no-verify", this.remote, `${commit}:refs/heads/${branch}`],
      {
        cwd: worktree,
        env: this.subprocessEnv(basic),
        extendEnv: false,
        reject: false,
        all: false,
      },
    );
    if (result.exitCode === 0) return;
    const raw = result.failed && result.exitCode === undefined ? result.message : result.stderr;
    throw new Error(`Falha no git push: ${redact(String(raw ?? ""), [token, basic])}`);
  }

  private subprocessEnv(basic: string): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (value === undefined || key === this.tokenEnv || STRIPPED_ENV.includes(key)) continue;
      out[key] = value;
    }
    return {
      ...out,
      GIT_CONFIG_COUNT: "2",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: basic ${basic}`,
      GIT_CONFIG_KEY_1: "core.hooksPath",
      GIT_CONFIG_VALUE_1: "/dev/null",
      GIT_TERMINAL_PROMPT: "0",
    };
  }
}

function redact(text: string, secrets: string[]): string {
  return secrets.reduce((acc, s) => (s === "" ? acc : acc.split(s).join("***")), text);
}
