import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildToolPolicy } from "../src/index.ts";
import { agentFor, judge, qa, specialist } from "./policy-helpers.ts";

const forbidden = (agent: ReturnType<typeof agentFor>) => {
  const r = buildToolPolicy(agent, "/work/wt/17");
  return r.ok ? null : r.forbiddenTools;
};

describe("buildToolPolicy", () => {
  it("accepts allowed tools per role and rejects forbidden ones", () => {
    expect(buildToolPolicy(specialist(), "/work/wt/17").ok).toBe(true);
    expect(buildToolPolicy(qa(), "/work/wt/17").ok).toBe(true);
    expect(buildToolPolicy(judge(), "/work/wt/17").ok).toBe(true);
    expect(forbidden(qa({ tools: ["Read", "Write"] }))).toEqual(["Write"]);
    expect(forbidden(qa({ tools: ["Read", "Edit"] }))).toEqual(["Edit"]);
    expect(forbidden(judge({ tools: ["Read", "Bash"] }))).toEqual(["Bash"]);
    expect(forbidden(judge({ tools: ["Read", "Edit", "Write"] }))).toEqual(["Edit", "Write"]);
    expect(
      forbidden(specialist({ states: ["InProgress", "QA"], tools: ["Read", "Write"] })),
    ).toEqual(["Write"]);
    expect(forbidden(specialist({ states: ["InProgress", "InReview"], tools: ["Bash"] }))).toEqual([
      "Bash",
    ]);
  });

  it("imports only allowed modules", () => {
    const files = ["tool-policy", "tool-decision", "bash-allow", "registry-root"];
    for (const f of files) {
      const src = readFileSync(resolve(import.meta.dirname, `../src/${f}.ts`), "utf8");
      const specs = [...src.matchAll(/from "([^"]+)"/g)].map((m) => m[1]!);
      for (const s of specs) {
        expect(s, `${f} imports ${s}`).toMatch(
          /^(node:path|node:fs|node:fs\/promises|@friday\/[^/]+|\.\/[\w-]+\.ts)$/,
        );
      }
    }
  });
});
