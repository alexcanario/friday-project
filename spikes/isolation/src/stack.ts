// Test helpers: an internal agent network, an internal upstream network, the proxy and a stub server.
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { IMAGE, LABEL } from "./docker-args.ts";

export interface Stack {
  agentNetwork: string;
  upstreamNetwork: string;
  proxyUrl: string;
  destroy(): void;
}

function docker(args: string[]): string {
  return execFileSync("docker", args, { encoding: "utf8", timeout: 110000, stdio: ["ignore", "pipe", "pipe"] });
}

function waitListening(name: string): void {
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    if (docker(["logs", name]).includes("listening")) return;
    execFileSync("sleep", ["0.3"]);
  }
  throw new Error(`contêiner ${name} não ficou pronto`);
}

const STUB = "require('http').createServer((q,s)=>s.end('allowed')).listen(80,()=>console.log('listening'))";

export function createStack(): Stack {
  const id = randomBytes(4).toString("hex");
  const agentNetwork = `friday-iso-agent-${id}`;
  const upstreamNetwork = `friday-iso-up-${id}`;
  const proxy = `friday-iso-proxy-${id}`;
  const stub = `friday-iso-stub-${id}`;
  const stack: Stack = {
    agentNetwork,
    upstreamNetwork,
    proxyUrl: `http://${proxy}:3128`,
    destroy() {
      for (const name of [proxy, stub]) {
        try {
          docker(["rm", "-f", name]);
        } catch {
          // already gone
        }
      }
      for (const net of [agentNetwork, upstreamNetwork]) {
        try {
          docker(["network", "rm", net]);
        } catch {
          // already gone
        }
      }
    },
  };
  try {
    for (const net of [agentNetwork, upstreamNetwork]) docker(["network", "create", "--internal", "--label", LABEL, net]);
    // The stub binds port 80, so it keeps Docker's default capabilities (it is test scaffolding, not the agent).
    docker([
      "run", "-d", "--label", LABEL, "--name", stub, "--read-only", "--network", upstreamNetwork,
      "--network-alias", "allowed.test", IMAGE, "node", "-e", STUB,
    ]);
    docker([
      "run", "-d", "--label", LABEL, "--name", proxy, "--read-only", "--user", "1000:1000", "--cap-drop=ALL",
      "--security-opt=no-new-privileges", "--network", agentNetwork, "-e", "ALLOWLIST=allowed.test",
      "-v", `${resolve(import.meta.dirname)}:/app:ro`, IMAGE, "node", "/app/proxy.ts",
    ]);
    docker(["network", "connect", upstreamNetwork, proxy]);
    waitListening(stub);
    waitListening(proxy);
  } catch (err) {
    stack.destroy();
    throw err;
  }
  return stack;
}
