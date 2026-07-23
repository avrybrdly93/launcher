/**
 * Solver panel's non-rendering logic (§6.3 panel group 5: "method dropdown
 * (grouped: fixed / adaptive / geometric / implicit), h or rtol/atol,
 * controller I/PI"; P3.23). Split out from the `.tsx` component for the
 * same reason `environment-panel-logic.ts` is: the group-swap transition --
 * this task's actual validation surface ("invalid combos (h with adaptive)
 * prevented by schema") -- is directly unit-testable without a DOM.
 *
 * `integrate()` (`@ballista/solverkit`) decides fixed vs. adaptive stepping
 * purely from whether `cfg.rtol` is set, independent of `cfg.h`, and throws
 * if an adaptive request (`rtol` set) targets a stepper with no embedded
 * pair. So "h with adaptive" isn't prevented by rejecting a value
 * combination after the fact -- it's prevented by construction: this
 * panel's fixed/adaptive schemas are disjoint (`fixedSolverPanelSchema` has
 * `h` and nothing else; `adaptiveSolverPanelSchema` has `rtol`/`atol`/
 * `controller` and nothing else), and {@link toSolverConfigForStepper}
 * always rebuilds a fresh `SolverConfigSpec` containing only the new
 * group's fields when the group changes, rather than layering the new
 * group's fields on top of the old ones -- so a stepper from one group can
 * never carry the other group's field into the committed spec.
 *
 * Geometric (Verlet) and implicit (backward-Euler) steppers exist in
 * `@ballista/solverkit` (P2.16/P2.38) but aren't yet in
 * `scenario-resolver.ts`'s `STEPPER_FACTORIES` -- wiring them requires
 * `model.partitions`/Jacobian support the runtime layer doesn't resolve
 * yet (§5.5 worked example #3, P4.10). Only the two groups a committed
 * `ScenarioSpec` can actually run today (fixed, adaptive) are listed here;
 * adding the other two groups is that future wiring task's concern, not
 * this panel's.
 */

import type { SolverConfigSpec } from "@ballista/engine";
import { z } from "zod";

/** A stepper this panel's dropdown offers, and which schema its params come from. */
export interface SolverStepperOption {
  readonly id: string;
  readonly label: string;
  readonly group: "fixed" | "adaptive";
}

/**
 * Every stepper id `resolveStepper` (`@ballista/runtime`) can build, grouped
 * per §6.3's "fixed / adaptive" split (`"rk45"` is `resolveStepper`'s alias
 * for `"dopri5"`, the same live instance -- listed once, not twice).
 */
export const SOLVER_STEPPER_OPTIONS: readonly SolverStepperOption[] = [
  { id: "explicit-euler", label: "Explicit Euler", group: "fixed" },
  { id: "midpoint-rk2", label: "Midpoint RK2", group: "fixed" },
  { id: "heun-rk2", label: "Heun RK2", group: "fixed" },
  { id: "classical-rk4", label: "Classical RK4", group: "fixed" },
  { id: "bogacki-shampine-32", label: "Bogacki-Shampine 3(2)", group: "adaptive" },
  { id: "dopri5", label: "Dormand-Prince 5(4)", group: "adaptive" },
];

export const SOLVER_GROUP_LABELS: Readonly<Record<"fixed" | "adaptive", string>> = {
  fixed: "Fixed-step",
  adaptive: "Adaptive",
};

/** The group a stepper id belongs to, or `undefined` for an id this panel doesn't offer. */
export function solverGroupFor(stepperId: string): "fixed" | "adaptive" | undefined {
  return SOLVER_STEPPER_OPTIONS.find((option) => option.id === stepperId)?.group;
}

const DEFAULT_H = 0.01;
const DEFAULT_RTOL = 1e-6;
const DEFAULT_ATOL = 1e-6;
const DEFAULT_CONTROLLER = "I";

/** The fixed group's only param: step size h. */
export const fixedSolverPanelSchema = z.object({
  h: z.number().min(0.0001).max(0.5).step(0.0001).describe("Step size h|s"),
});

/**
 * The adaptive group's params. `atol` is exposed as a single scalar applied
 * uniformly -- `SolverConfigSpec.atol` also accepts a per-channel array, but
 * that's not a shape `generateControlDescriptors` (P3.18) maps to a control
 * (arrays are skipped, not guessed at, matching `schema-controls.ts`'s own
 * contract); a per-channel tolerance editor is out of this panel's scope.
 * `rtol`/`atol` are plain number inputs, not sliders: their meaningful
 * range spans many decades, which a linear slider (this generator's only
 * kind) can't usefully represent.
 */
export const adaptiveSolverPanelSchema = z.object({
  rtol: z.number().positive().describe("Relative tolerance rtol"),
  atol: z.number().positive().describe("Absolute tolerance atol"),
  controller: z.enum(["I", "PI"]).describe("Step-size controller"),
});

/** `fixedSolverPanelSchema`'s field values, defaulted when unset. */
export function fixedPanelValues(spec: SolverConfigSpec): { h: number } {
  return { h: spec.h ?? DEFAULT_H };
}

/** A representative scalar for `SolverConfigSpec.atol` (see `adaptiveSolverPanelSchema`'s doc). */
function atolScalar(atol: SolverConfigSpec["atol"]): number {
  if (atol === undefined) return DEFAULT_ATOL;
  return Array.isArray(atol) ? (atol[0] ?? DEFAULT_ATOL) : atol;
}

/** `adaptiveSolverPanelSchema`'s field values, defaulted when unset. */
export function adaptivePanelValues(spec: SolverConfigSpec): {
  rtol: number;
  atol: number;
  controller: "I" | "PI";
} {
  return {
    rtol: spec.rtol ?? DEFAULT_RTOL,
    atol: atolScalar(spec.atol),
    controller: spec.controller ?? DEFAULT_CONTROLLER,
  };
}

/**
 * Seeds a `SolverConfigSpec` for `stepperId`: when its group differs from
 * `current`'s stepper's group, rebuilds the spec from only that group's
 * fields (dropping the old group's, per this module's doc comment) --
 * otherwise (same group, e.g. switching between two fixed methods) just
 * swaps `.stepper`, keeping the existing h/rtol/atol/controller values.
 * `maxSteps`/`hMin` are always carried through unchanged; this panel
 * doesn't expose them.
 */
export function toSolverConfigForStepper(
  stepperId: string,
  current: SolverConfigSpec,
): SolverConfigSpec {
  const currentGroup = solverGroupFor(current.stepper);
  const nextGroup = solverGroupFor(stepperId);

  if (currentGroup === nextGroup) {
    return { ...current, stepper: stepperId };
  }

  const shared = {
    stepper: stepperId,
    maxSteps: current.maxSteps,
    ...(current.hMin !== undefined && { hMin: current.hMin }),
  };

  if (nextGroup === "fixed") {
    return { ...shared, h: fixedPanelValues(current).h };
  }
  if (nextGroup === "adaptive") {
    const { rtol, atol, controller } = adaptivePanelValues(current);
    return { ...shared, rtol, atol, controller };
  }
  return shared;
}
