import type { RunFinished } from "@friday/contracts";
import type { RunHeldReason } from "@friday/domain";

const reasons: Record<RunFinished["status"], RunHeldReason | null> = {
  succeeded: null,
  budget_exceeded: "BudgetExceeded",
  turns_exceeded: "TurnsExceeded",
  invalid_output: "SchemaInvalid",
  misconfigured: "RunMisconfigured",
  timeout: "RuntimeFailed",
  failed: "RuntimeFailed",
};

export function heldReasonFor(finished: RunFinished): RunHeldReason | null {
  return reasons[finished.status];
}
