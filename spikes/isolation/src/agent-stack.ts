// Network for the real agent: an internal agent network and a proxy that is the only way out (api.anthropic.com).
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { IMAGE, LABEL } from "./docker-args.ts";

export interface EgressStack {
  agentNetwork: string;
  proxyUrl: string;
  destroy(): void;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 110000, stdio: ["ignore", "pipe", "pipe"] });
}

function quiet(args: string[]): void {
  try {
    docker(args);
  } catch {
    // already gone
  }
}

export function createEgressStack(allowlist: string[]): EgressStack {
  const id = randomBytes(4).toString("hex");
  const agentNetwork = `friday-agent-net-${id}`;
  const proxy = `friday-agent-proxy-${id}`;
  const stack: EgressStack = {
    agentNetwork,
    proxyUrl: `http://${proxy}:3128`,
    destroy() {
      quiet(["rm", "-f", proxy]);
      quiet(["network", "rm", agentNetwork]);
    },
  };
  try {
    docker(["network", "create", "--internal", "--label", LABEL, agentNetwork]);
    docker([
      "run", "-d", "--label", LABEL, "--name", proxy, "--read-only", "--user", "1000:1000", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--network", agentNetwork, "-e", `ALLOWLIST=${allowlist.join(",")}`,
      "-v", `${resolve(import.meta.dirname)}:/app:ro`, IMAGE, "node", "/app/proxy.ts",
    ]);
    // The default bridge is the proxy's only way out; the agent never joins it.
    docker(["network", "connect", "bridge", proxy]);
  } catch (err) {
    stack.destroy();
    throw err;
  }
  return stack;
}
