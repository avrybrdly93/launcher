/**
 * Regime tags (§3.9/§6.3, P3.33's "preset browser with regime tags (Π,
 * stiff, Magnus)"): a small, filterable classification of a `ScenarioSpec`
 * built entirely from existing pure classifiers rather than new physics --
 * `scenarioNondimensionalGroups` (P1.38) for Π and `recommendSolver`
 * (P2.47) for the stiffness regime, matching the exact vocabulary already
 * used informally throughout the codebase (e.g.
 * `golden-trajectory-store.ts`'s "low-Π shot put, high-Π table tennis,
 * Magnus-bearing golf drive, stiff dust grain").
 */
import { scenarioNondimensionalGroups } from "./scenario-metadata.js";
import type { ScenarioSpec } from "./scenario-spec.js";
import { recommendSolver } from "./solver-advisor.js";

export type RegimeTag = "low-pi" | "high-pi" | "magnus" | "stiff";

/** Every tag {@link scenarioRegimeTags} can produce, in the fixed display order the preset browser's filter chips use. */
export const ALL_REGIME_TAGS: readonly RegimeTag[] = ["low-pi", "high-pi", "magnus", "stiff"];

/** P1.38's own validated regime boundary: Π(shot put) < 0.1 < Π(table-tennis ball). */
const PI_REGIME_THRESHOLD = 0.1;

/**
 * Classifies `spec` into zero or more {@link RegimeTag}s: exactly one of
 * `"low-pi"`/`"high-pi"` (Π's drag-negligible-vs-drag-dominated split, P1.38's
 * own 0.1 boundary), plus `"magnus"` when a Magnus force is wired, plus
 * `"stiff"` when `recommendSolver` (P2.47) classifies the scenario as
 * numerically stiff.
 */
export function scenarioRegimeTags(spec: ScenarioSpec): readonly RegimeTag[] {
  const tags: RegimeTag[] = [];

  const { pi } = scenarioNondimensionalGroups(spec);
  tags.push(pi < PI_REGIME_THRESHOLD ? "low-pi" : "high-pi");

  if (spec.model.forceIds.includes("magnus")) tags.push("magnus");
  if (recommendSolver(spec).regime === "stiff") tags.push("stiff");

  return tags;
}
