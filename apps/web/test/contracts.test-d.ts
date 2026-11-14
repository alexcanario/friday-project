import type { IssueItem } from "@friday/contracts";
import { expectTypeOf, it } from "vitest";

it("issue item type comes from contracts", () => {
  expectTypeOf<IssueItem>().toEqualTypeOf<{
    issueId: number;
    state: string;
    heldReason: string | null;
  }>();
  // @ts-expect-error issueId is a number
  const bad: IssueItem = { issueId: "14", state: "ready", heldReason: null };
  void bad;
});
