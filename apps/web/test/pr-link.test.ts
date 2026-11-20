import { describe, expect, it } from "vitest";
import { prUrl } from "../src/pr-link.ts";

describe("pr link", () => {
  it("builds the PR URL only for an owner/repo project", () => {
    expect(prUrl("alexcanario/friday-project", 7)).toBe(
      "https://github.com/alexcanario/friday-project/pull/7",
    );
    expect(prUrl("a.b/c_d", 1)).toBe("https://github.com/a.b/c_d/pull/1");
    const bad = [
      "javascript:alert(1)//x",
      "evil.com/x/y",
      "//evil.com",
      "../x",
      "a/..",
      "o/r?x=1",
      "o/r#h",
      "o /r",
      "o",
      "",
    ];
    for (const project of bad) expect(prUrl(project, 7)).toBeNull();
    for (const n of [0, -1, 1.5]) expect(prUrl("o/r", n)).toBeNull();
  });
});
