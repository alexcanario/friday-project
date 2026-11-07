import { existsSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { execa } from "execa";
import type { GitHost } from "@friday/application";
import { isInside } from "./config-root-guard.ts";

export interface GitCliHostOptions {
  tokenEnv: string;
  mirrorDir: string;
  targetUrl: string;
  env?: Record<string, string | undefined>;
  gitBinary?: string;
}

type PushRequest = Parameters<GitHost["push"]>[0];

const COMMIT_RE = /^[0-9a-f]{40}$/;
const BRANCH_RE = /^friday\/[0-9]+(-[a-z0-9-]+)?$/;
const ALLOWED_KEYS = new Set(["PATH", "HOME", "USERPROFILE", "SYSTEMROOT", "TEMP", "TMP", "LANG"]);
const HOOKS_OFF = "/dev/null";

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

export class GitCliHost implements GitHost {
  private readonly tokenEnv: string;
  private readonly mirrorDir: string;
  private readonly targetUrl: string;
  private readonly env: Record<string, string | undefined>;
  private readonly git: string;

  constructor({
    tokenEnv,
    mirrorDir,
    targetUrl,
    env = process.env,
    gitBinary = "git",
  }: GitCliHostOptions) {
    if (tokenEnv.trim() === "") {
      throw new Error("O nome da variável de ambiente do token não pode ser vazio.");
    }
    if (ALLOWED_KEYS.has(tokenEnv.toUpperCase())) {
      throw new Error(
        "O nome da variável de ambiente do token não pode ser uma variável da lista de permissão do ambiente do git.",
      );
    }
    if (!isAbsolute(mirrorDir)) {
      throw new Error("O diretório do espelho deve ser um caminho absoluto.");
    }
    validateTargetUrl(targetUrl);
    this.tokenEnv = tokenEnv;
    this.mirrorDir = mirrorDir;
    this.targetUrl = targetUrl;
    this.env = env;
    this.git = gitBinary;
  }

  async push(request: PushRequest): Promise<void> {
    this.validate(request);
    const token = this.env[this.tokenEnv];
    if (token === undefined || token.trim() === "") {
      throw new Error(`A variável de ambiente ${this.tokenEnv} não está definida.`);
    }
    const { worktree, branch, commit } = request;
    const mirror = this.mirrorDir;
    if (!existsSync(join(mirror, "HEAD"))) {
      await this.run(["init", "--bare", "--quiet", mirror], this.baseEnv(), undefined, "init");
    }
    const b64 = Buffer.from(`x-access-token:${token}`).toString("base64");
    const fetchEnv = { ...this.baseEnv(), ...hooksConfig([]) };
    await this.run(
      ["--git-dir", mirror, "fetch", "--no-tags", "--quiet", worktree, commit],
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
  }

  private validate({ worktree, branch, commit }: PushRequest): void {
    if (!COMMIT_RE.test(commit)) throw new Error("O commit deve ter 40 caracteres hexadecimais.");
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
  const pairs: [string, string][] = [...extra, ["core.hooksPath", HOOKS_OFF]];
  const out: Record<string, string> = { GIT_CONFIG_COUNT: String(pairs.length) };
  pairs.forEach(([key, value], i) => {
    out[`GIT_CONFIG_KEY_${i}`] = key;
    out[`GIT_CONFIG_VALUE_${i}`] = value;
  });
  return out;
}
