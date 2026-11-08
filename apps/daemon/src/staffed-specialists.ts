import type { Triage } from "@friday/contracts";

/** Specialists with a ficha today (D70: only backend). Widened by #314. */
export const STAFFED_SPECIALISTS = ["backend"] as const satisfies readonly Triage["specialist"][];
