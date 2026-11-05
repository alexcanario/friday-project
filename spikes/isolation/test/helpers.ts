import { execFileSync, spawnSync } from "node:child_process";

export function dockerAvailable(): boolean {
  const result = spawnSync("docker", ["info"], { stdio: "ignore", timeout: 20000 });
  return result.status === 0;
}

// Docker tests are skipped only when Docker is missing and we are not in CI.
export const skipDocker = !dockerAvailable() && process.env.CI !== "true";

export function docker(args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 110000,
    stdio: ["ignore", "pipe", "pipe"],
  });
}
