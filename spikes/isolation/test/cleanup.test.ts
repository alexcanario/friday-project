import { describe, expect, it } from "vitest";
import { docker, skipDocker } from "./helpers.ts";

const filter = "label=friday-spike=isolation";

describe.skipIf(skipDocker)("cleanup", () => {
  it("leaves no containers or networks behind", async () => {
    // Other files run first or finish their teardown; wait for stragglers instead of racing them.
    const deadline = Date.now() + 60000;
    let containers = "";
    let networks = "";
    do {
      containers = docker(["ps", "-a", "--filter", filter, "-q"]).trim();
      networks = docker(["network", "ls", "--filter", filter, "-q"]).trim();
      if (containers === "" && networks === "") break;
      await new Promise((r) => setTimeout(r, 2000));
    } while (Date.now() < deadline);
    expect(containers).toBe("");
    expect(networks).toBe("");
  });
});
