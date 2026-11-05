import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";

export const IMAGE = "node:26-slim";
export const LABEL = "friday-spike=isolation";
const FORBIDDEN_ENV = ["ANTHROPIC_API_KEY", "GITHUB_TOKEN", "GH_TOKEN"];
const FORBIDDEN_SEGMENTS = [".claude", ".ssh", ".env"];

export interface DockerArgsOptions {
  worktree: string;
  network: string;
  env: Record<string, string>;
  command: string[];
  extraMounts?: string[];
}

// The home folder itself or any folder above it would expose everything inside.
function containsHome(path: string): boolean {
  const fromPath = relative(path, resolve(homedir()));
  return !fromPath.startsWith("..") && !isAbsolute(fromPath);
}

function assertMountAllowed(entry: string): void {
  const host = entry.split(":")[0] as string;
  const path = resolve(host);
  const segments = path.split(/[\\/]/);
  const forbidden =
    path === "/var/run/docker.sock" ||
    path === "/run/docker.sock" ||
    containsHome(path) ||
    FORBIDDEN_SEGMENTS.some((segment) => segments.includes(segment));
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
