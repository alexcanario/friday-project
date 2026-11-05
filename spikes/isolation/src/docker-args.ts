import { homedir } from "node:os";
import { resolve } from "node:path";

export const IMAGE = "node:26-slim";
export const LABEL = "friday-spike=isolation";
const FORBIDDEN_ENV = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"];
const FORBIDDEN_SUFFIXES = ["/.claude", "/.ssh", "/.env"];

export interface DockerArgsOptions {
  worktree: string;
  network: string;
  env: Record<string, string>;
  command: string[];
  extraMounts?: string[];
}

function assertMountAllowed(entry: string): void {
  const host = entry.split(":")[0] as string;
  const path = resolve(host);
  const forbidden =
    path === "/var/run/docker.sock" ||
    path === "/run/docker.sock" ||
    path === resolve(homedir()) ||
    FORBIDDEN_SUFFIXES.some((suffix) => path.endsWith(suffix));
  if (forbidden) throw new Error(`montagem proibida: ${host}`);
}

export function buildDockerArgs(opts: DockerArgsOptions): string[] {
  for (const key of Object.keys(opts.env)) {
    if (FORBIDDEN_ENV.includes(key)) throw new Error(`variável proibida: ${key}`);
  }
  const extra = opts.extraMounts ?? [];
  for (const entry of [opts.worktree, ...extra]) assertMountAllowed(entry);
  const args = [
    "run",
    "--rm",
    "--user",
    "1000:1000",
    "--read-only",
    "--tmpfs",
    "/tmp",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges",
    "--network",
    opts.network,
    "--label",
    LABEL,
    "-w",
    "/work",
    "-v",
    `${opts.worktree}:/work`,
  ];
  for (const entry of extra) args.push("-v", entry.includes(":") ? entry : `${entry}:${entry}:ro`);
  for (const [key, value] of Object.entries(opts.env)) args.push("-e", `${key}=${value}`);
  return [...args, IMAGE, ...opts.command];
}
