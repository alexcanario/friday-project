import type { IssueItem, RunItem } from "@friday/contracts";
import type { ComponentProps } from "react";
import { expectTypeOf, it } from "vitest";
import type { ProjectScreenView } from "../src/ProjectView.tsx";

type Props = ComponentProps<typeof ProjectScreenView>;

it("view props use the contracts types", () => {
  expectTypeOf<Props["issues"]>().toEqualTypeOf<IssueItem[]>();
  expectTypeOf<Props["runs"]>().toEqualTypeOf<RunItem[]>();
  const bad: Props = {
    host: { name: "h1", baseUrl: "" },
    project: "o/r",
    state: "ready",
    // @ts-expect-error issueId is a number
    issues: [{ issueId: "14" }],
    runs: [],
  };
  void bad;
});
