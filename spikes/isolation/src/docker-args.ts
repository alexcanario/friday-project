import { homedir } from "node:os";
import { isAbsolute, posix, relative, resolve } from "node:path";

export const IMAGE = "node:26-slim";
export const LABEL = "friday-spike=isolation";
const FORBIDDEN_ENV = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN", "GITHUB_TOKEN", "GH_TOKEN"];
const FORBIDDEN_SEGMENTS = [".claude", ".ssh", ".env"];
const DOCKER_SOCKET_FOLDERS = ["/", "/var", "/var/run", "/run"];
const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

export interface DockerArgsOptions {
  worktree: string;
  network: string;
  env: Record<string, string>;
  command: string[];
  extraMounts?: string[];
  // Only the real-agent run (#58) needs the API key inside; every other variable stays forbidden.
  allowApiKey?: boolean;
}

// The home folder itself or any folder above it would expose everything inside.
function containsHome(path: string): boolean {
  const fromPath = relative(path, resolve(homedir()));
  return !fromPath.startsWith("..") && !isAbsolute(fromPath);
}

// Splits `host[:container[:options]]` at the first colon that is not the one of a drive letter (`V:\repo`).
export function splitMount(entry: string): { host: string; rest: string } {
  const from = /^[A-Za-z]:[\\/]/.test(entry) ? 2 : 0;
  const colon = entry.indexOf(":", from);
  return colon === -1 ? { host: entry, rest: "" } : { host: entry.slice(0, colon), rest: entry.slice(colon + 1) };
}

// The same path written the POSIX way, lower case: `V:\Var\Run` and `//var/run` both become `/var/run`.
function posixForm(host: string): string {
  const slashes = host.replace(/\\/g, "/").replace(/^[A-Za-z]:(?=\/|$)/, "");
  return posix.normalize(slashes.replace(/\/+/g, "/")).toLowerCase();
}

function assertMountAllowed(entry: string): void {
  const { host } = splitMount(entry);
  const path = resolve(host);
  const segments = [...path.split(/[\\/]/), ...posixForm(host).split("/")].map((segment) => segment.toLowerCase());
  const forbidden =
    // The socket works through a read-only bind mount, so it and every folder above it are out.
    DOCKER_SOCKET_FOLDERS.includes(posixForm(host)) ||
    segments.includes("docker.sock") ||
    containsHome(path) ||
    FORBIDDEN_SEGMENTS.some((segment) => segments.includes(segment));
  if (forbidden) throw new Error(`montagem proibida: ${host}`);
}

// Extra mounts are always read-only: no option but `ro` is accepted.
function readOnlyMount(entry: string): string {
  const { host, rest } = splitMount(entry);
  const [container = host, ...options] = rest === "" ? [] : rest.split(":");
  if (options.length > 1 || (options.length === 1 && options[0] !== "ro")) throw new Error(`montagem proibida: ${entry}`);
  return `${host}:${container}:ro`;
}

export function buildDockerArgs(opts: DockerArgsOptions): string[] {
  for (const key of Object.keys(opts.env)) {
    // A name with `=` would let `-e KEY=value` define another variable than the one checked.
    if (!ENV_NAME.test(key)) throw new Error(`variável proibida: ${key}`);
    if (FORBIDDEN_ENV.includes(key) && !(opts.allowApiKey && key === "ANTHROPIC_API_KEY")) throw new Error(`variável proibida: ${key}`);
  }
  const extra = opts.extraMounts ?? [];
  for (const entry of [opts.worktree, ...extra]) assertMountAllowed(entry);
  const readOnly = extra.map(readOnlyMount);
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
  for (const mount of readOnly) args.push("-v", mount);
  for (const [key, value] of Object.entries(opts.env)) args.push("-e", `${key}=${value}`);
  return [...args, IMAGE, ...opts.command];
}
