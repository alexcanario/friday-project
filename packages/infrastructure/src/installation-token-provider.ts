import { createPrivateKey } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createAppAuth } from "@octokit/auth-app";
import { Octokit } from "octokit";

export interface InstallationTokenProviderInput {
  appId: number;
  installationId: number;
  privateKeyPath: string;
  /** Narrows the installation token; omitted means every permission of the App. */
  permissions?: { pull_requests?: "write" | "read" };
  now: () => number;
  fetch: typeof fetch;
}

const RENEW_MARGIN_MS = 300_000;

async function readRsaKey(path: string): Promise<string> {
  const invalid = new Error(
    `Chave privada do App inválida em ${path}: esperado PEM RSA (pkcs8 ou pkcs1).`,
  );
  let pem: string;
  try {
    pem = await readFile(path, "utf8");
  } catch {
    throw new Error(`Não foi possível ler a chave privada do App em ${path}.`);
  }
  try {
    if (createPrivateKey(pem).asymmetricKeyType !== "rsa") throw invalid;
  } catch {
    throw invalid;
  }
  return pem;
}

function statusOf(err: unknown): number | undefined {
  const status = (err as { status?: unknown } | null)?.status;
  return typeof status === "number" ? status : undefined;
}

export function createInstallationTokenProvider(input: InstallationTokenProviderInput): {
  getToken(): Promise<string>;
} {
  let cached: { token: string; expiresAtMs: number } | undefined;

  async function exchange(): Promise<{ token: string; expiresAtMs: number }> {
    const privateKey = await readRsaKey(input.privateKeyPath);
    const request = new Octokit({ request: { fetch: input.fetch, retries: 0 } }).request;
    const auth = createAppAuth({
      appId: input.appId,
      privateKey,
      installationId: input.installationId,
      request,
    });
    let failure: unknown;
    const res = await auth({
      type: "installation",
      refresh: true,
      ...(input.permissions === undefined ? {} : { permissions: input.permissions }),
    }).catch((err: unknown) => {
      failure = err;
      return undefined;
    });
    if (!res) {
      const status = statusOf(failure);
      throw new Error(
        status === undefined
          ? "Falha de rede ao obter o token de instalação do App."
          : `Falha ao obter o token de instalação do App (HTTP ${status}).`,
      );
    }
    return { token: res.token, expiresAtMs: Date.parse(res.expiresAt ?? "") };
  }

  return {
    async getToken() {
      if (cached && cached.expiresAtMs - input.now() >= RENEW_MARGIN_MS) return cached.token;
      const fresh = await exchange();
      cached = Number.isFinite(fresh.expiresAtMs) ? fresh : undefined;
      return fresh.token;
    },
  };
}
