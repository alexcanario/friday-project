import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("ci.yml", () => {
  it("ci.yml runs the spike tests without secrets and keeps job check", () => {
    const text = readFileSync(resolve(import.meta.dirname, "../../../.github/workflows/ci.yml"), "utf8");
    const jobsIndex = text.indexOf("\njobs:");
    const jobs = text.slice(jobsIndex);
    expect(jobs).toMatch(/^ {2}check:/m);
    expect(text).not.toContain("strategy:");
    expect(text).not.toContain("matrix");
    expect(text).not.toContain("ANTHROPIC_API_KEY");
    expect(text).toMatch(/permissions:\s*\n\s+contents: read/);
    const check = jobs.slice(jobs.search(/^ {2}check:/m));
    expect(check).toContain("pnpm --dir spikes/agent-sdk --ignore-workspace install --frozen-lockfile");
    expect(check).toContain("pnpm --dir spikes/agent-sdk test");
  });
});
