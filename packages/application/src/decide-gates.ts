import type { Risk } from "@friday/domain";
import { matchesGlob } from "./glob-match.ts";

export type GateInput = {
  risk: Risk;
  mergeMode: "manual" | "auto";
  changedPaths: string[];
  screenPaths: string[];
  issueGates: string[];
};

export type GateDecision = {
  risk: Risk;
  autoMerge: boolean;
  humanReview: boolean;
  gates: string[];
};

const SECURITY_GLOBS = [".github/workflows/**", ".claude/**"];

const anyMatch = (globs: readonly string[], paths: readonly string[]): boolean =>
  paths.some((p) => globs.some((g) => matchesGlob(g, p)));

export const decideGates = (input: GateInput): GateDecision => {
  const gates = new Set(input.issueGates);
  if (anyMatch(SECURITY_GLOBS, input.changedPaths)) gates.add("gate:security");
  if (anyMatch(input.screenPaths, input.changedPaths)) gates.add("gate:screen");
  const sorted = [...gates].sort();
  const autoMerge = input.risk === "low" && input.mergeMode === "auto" && sorted.length === 0;
  return { risk: input.risk, autoMerge, humanReview: !autoMerge, gates: sorted };
};
