import type { ApprovalItem, StatusResponse } from "@friday/contracts";
import type { ComponentProps } from "react";
import { expectTypeOf, it } from "vitest";
import type { ApprovalsView } from "../src/ApprovalsView.tsx";

it("view props use the contracts types", () => {
  expectTypeOf<ComponentProps<typeof ApprovalsView>["approvals"]>().toEqualTypeOf<ApprovalItem[]>();
  expectTypeOf<ComponentProps<typeof ApprovalsView>["status"]>().toEqualTypeOf<StatusResponse>();
  const bad: ComponentProps<typeof ApprovalsView> = {
    status: { enabled: null, breaker: { open: false, openedAt: null, failures: [] } },
    hasToken: true,
    message: null,
    onApprove: () => undefined,
    onDeny: () => undefined,
    // @ts-expect-error approvals must be ApprovalItem[]
    approvals: [{ id: 1 }],
  };
  void bad;
});
