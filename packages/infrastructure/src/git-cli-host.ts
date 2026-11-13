import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { execa } from "execa";
import type { GitHost } from "@friday/application";
import { isInside } from "./config-root-guard.ts";
import { commitWorktree, configEnv, FRIDAY_AUTHOR, HOOKS_OFF } from "./git-cli-commit.ts";

export { FRIDAY_AUTHOR };

export interface GitCliHostOptions {
  /** Name of the environment variable holding the token; exclusive with `token`. */
  tokenEnv?: string;
  /** Asked for the token on every push; exclusive with `tokenEnv`. */
  token?: () => Promise<string>;
  mirrorDir: string;
  targetUrl: string;
  env?: Record<string, string | undefined>;
  gitBinary?: string;
  /** Exists only for tests: runs after the worktree validation and before the first git step. */
  afterValidate?: () => Promise<void>;
}

type PushRequest = Parameters<GitHost["push"]>[0];

const BRANCH_RE = /^friday\/[0-9]+(-[a-z0-9-]+)?$/;
export const ALLOWED_KEYS = new Set([
  "PATH",
  "HOME",
  "USERPROFILE",
  "SYSTEMROOT",
  "TEMP",
  "TMP",
  "LANG",
]);

function validateTargetUrl(targetUrl: string): void {
  let url: URL;
  try {
    url = new URL(targetUrl);
  } catch {
    throw new Error("A URL do repositório alvo é inválida.");
  }
  const schemeOk = targetUrl.startsWith("https://") || targetUrl.startsWith("file://");
  if (!schemeOk) throw new Error("A URL do repositório alvo deve começar em https:// ou file://.");
  if (url.username !== "" || url.password !== "") {
    throw new Error("A URL do repositório alvo não pode conter usuário ou senha.");
  }
}

function validateTokenSource(tokenEnv: string | undefined, token: unknown): void {
  if ((tokenEnv === undefined) === (token === undefined)) {
    throw new Error("Informe exatamente um entre tokenEnv e token.");
  }
  if (tokenEnv === undefined) return;
  if (tokenEnv.trim() === "") {
    throw new Error("O nome da variável de ambiente do token não pode ser vazio.");
  }
  if (ALLOWED_KEYS.has(tokenEnv.toUpperCase())) {
    throw new Error(
      "O nome da variável de ambiente do token não pode ser uma variável da lista de permissão do ambiente do git.",
    );
  }
}

export class GitCliHost implements GitHost {
  private readonly tokenEnv: string | undefined;
  private readonly tokenFn: (() => Promise<string>) | undefined;
  private readonly mirrorDir: string;
  private readonly targetUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly git: string;
  private readonly afterValidate: (() => Promise<void>) | undefined;

  constructor({
    tokenEnv,
    token,
    mirrorDir,
    targetUrl,
    env = process.env,
    gitBinary = "git",
    afterValidate,
  }: GitCliHostOptions) {
    validateTokenSource(tokenEnv, token);
    if (!isAbsolute(mirrorDir)) {
      throw new Error("O diretório do espelho deve ser um caminho absoluto.");
    }
    validateTargetUrl(targetUrl);
    this.tokenEnv = tokenEnv;
    this.tokenFn = token;
    this.mirrorDir = mirrorDir;
    this.targetUrl = targetUrl;
    this.env = env;
    this.git = gitBinary;
    this.afterValidate = afterValidate;
  }

  async push(request: PushRequest): Promise<{ sha: string }> {
    this.validate(request);
    const token = await this.resolveToken();
    const { worktree, branch, message } = request;
    const { sha: commit, gitDir } = await commitWorktree({
      git: this.git,
      worktree,
      message,
      baseEnv: this.baseEnv(),
      ...(this.afterValidate === undefined ? {} : { afterValidate: this.afterValidate }),
    });
    const mirror = this.mirrorDir;
    if (!existsSync(join(mirror, "HEAD"))) {
      await this.run(["init", "--bare", "--quiet", mirror], this.baseEnv(), undefined, "init");
    }
    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    const fetchEnv = { ...this.baseEnv(), ...hooksConfig([]) };
    await this.run(
      ["--git-dir", mirror, "fetch", "--no-tags", "--quiet", gitDir, commit],
      fetchEnv,
      [token, b64],
      "Falha ao buscar o commit no espelho: ",
    );
    const header = `Authorization: basic ${b64}`;
    const pushEnv = {
      ...this.baseEnv(),
      ...hooksConfig([["http.https://github.com/.extraheader", header]]),
    };
    await this.run(
      [
        "--git-dir",
        mirror,
        "push",
        "--no-verify",
        this.targetUrl,
        `${commit}:refs/heads/${branch}`,
      ],
      pushEnv,
      [token, b64, header],
      "Falha no git push: ",
    );
    return { sha: commit };
  }

  private async resolveToken(): Promise<string> {
    if (this.tokenFn !== undefined) {
      const value = await this.tokenFn();
      if (value.trim() === "") throw new Error("O token de push está vazio.");
      return value;
    }
    const value = this.env[this.tokenEnv ?? ""];
    if (value === undefined || value.trim() === "") {
      throw new Error(`A variável de ambiente ${this.tokenEnv} não está definida.`);
    }
    return value;
  }

  private validate(request: PushRequest): void {
    const { worktree, branch, message } = request;
    if ("commit" in request) throw new Error("O pedido não aceita o campo commit.");
    if (typeof message !== "string" || message.trim() === "") {
      throw new Error("A mensagem do commit não pode ser vazia.");
    }
    if (!BRANCH_RE.test(branch)) throw new Error(`Nome de branch inválido: ${branch}`);
    if (!isAbsolute(worktree)) throw new Error("O worktree deve ser um caminho absoluto.");
    if (resolve(worktree) === resolve(this.mirrorDir) || isInside(worktree, this.mirrorDir)) {
      throw new Error("O worktree não pode ser o espelho nem conter o espelho.");
    }
  }

  private baseEnv(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(this.env)) {
      if (value === undefined || !ALLOWED_KEYS.has(key.toUpperCase())) continue;
      out[key] = value;
    }
    out.GIT_TERMINAL_PROMPT = "0";
    return out;
  }

  private async run(
    args: string[],
    env: Record<string, string>,
    secrets: string[] | undefined,
    prefix: string,
  ): Promise<void> {
    const cwd = args[0] === "init" ? undefined : this.mirrorDir;
    const result = await execa(this.git, args, { cwd, env, extendEnv: false, reject: false });
    if (result.exitCode === 0) return;
    let stderr = String(result.stderr ?? "");
    for (const secret of secrets ?? []) stderr = stderr.split(secret).join("***");
    const label = prefix === "init" ? "Falha ao iniciar o espelho: " : prefix;
    throw new Error(`${label}${stderr}`);
  }
}

function hooksConfig(extra: [string, string][]): Record<string, string> {
  return configEnv([...extra, ["core.hooksPath", HOOKS_OFF]]);
}
