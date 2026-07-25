/**
 * Convergence-study harness (§7 P3.42, blueprint §6.3 "convergence-study
 * runner: pick scenario + methods + h ladder -> auto log-log plot with
 * fitted slopes"). Wraps `measureConvergence` (P2.07, `convergence-harness.ts`)
 * for every requested method against a single shared ground truth: since a
 * general scenario has no closed-form solution (only the drag-free preset
 * does), "exact" here means a tight-tolerance adaptive DOPRI5 run to the
 * scenario's own ground-impact event, held at a *fixed* t_f across every
 * method/h measured -- a convergence study needs one common comparison
 * point, not each h landing at its own event-crossing time (unlike
 * `solver-lab.ts`'s per-column landings, P3.41).
 */

import type { ScenarioSpec } from "@ballista/engine";
import {
  integrate,
  measureConvergence,
  type ConvergenceResult,
  type Stepper,
} from "@ballista/solverkit";
import { resolveModel, resolveStepper } from "./scenario-resolver.js";

const T_MAX_SECONDS = 60;
const REFERENCE_STEPPER_ID = "dopri5";
const REFERENCE_RTOL = 1e-12;
const REFERENCE_ATOL = 1e-12;

/** Every stepper id `resolveStepper` can build, usable as a convergence-study method, with a display label. Excludes `"rk45"` (a bare alias for `"dopri5"`, scenario-resolver.ts) so the picker doesn't list the same method twice. */
export const CONVERGENCE_STUDY_METHOD_OPTIONS: readonly {
  readonly id: string;
  readonly label: string;
}[] = [
  { id: "explicit-euler", label: "Explicit Euler" },
  { id: "midpoint-rk2", label: "Midpoint RK2" },
  { id: "heun-rk2", label: "Heun RK2" },
  { id: "classical-rk4", label: "Classical RK4" },
  { id: "bogacki-shampine-32", label: "Bogacki-Shampine 3(2)" },
  { id: "dopri5", label: "Dormand-Prince 5(4)" },
];

/** One method's fitted convergence result, labeled for display. */
export interface ConvergenceStudyMethodResult extends ConvergenceResult {
  readonly stepperId: string;
  readonly label: string;
}

/** Full convergence study: the shared fixed t_f every method was measured against, plus each method's result. */
export interface ConvergenceStudyResult {
  readonly tFinal: number;
  readonly methods: readonly ConvergenceStudyMethodResult[];
}

function labelFor(stepperId: string): string {
  return (
    CONVERGENCE_STUDY_METHOD_OPTIONS.find((option) => option.id === stepperId)?.label ?? stepperId
  );
}

/**
 * Runs a convergence study for `spec`: `measureConvergence` at each `h` in
 * `hs`, once per id in `stepperIds`, all against the same tight-tolerance
 * reference solve's final state at its own (fixed) landing time.
 */
export function runConvergenceStudy(
  spec: ScenarioSpec,
  stepperIds: readonly string[],
  hs: readonly number[],
): ConvergenceStudyResult {
  const { model, ctx, y0 } = resolveModel(spec);

  const referenceStepper: Stepper = resolveStepper(REFERENCE_STEPPER_ID);
  const referenceReport = integrate(
    model,
    ctx,
    y0,
    [0, T_MAX_SECONDS],
    {
      stepper: REFERENCE_STEPPER_ID,
      rtol: REFERENCE_RTOL,
      atol: REFERENCE_ATOL,
      maxSteps: Number.MAX_SAFE_INTEGER,
    },
    referenceStepper,
  );

  const tFinal = referenceReport.tFinal;
  const yExact = () => referenceReport.yFinal;

  const methods = stepperIds.map((stepperId): ConvergenceStudyMethodResult => {
    const result = measureConvergence(
      () => resolveStepper(stepperId),
      model,
      ctx,
      y0,
      [0, tFinal],
      yExact,
      hs,
    );
    return { ...result, stepperId, label: labelFor(stepperId) };
  });

  return { tFinal, methods };
}

/**
 * Serializes a convergence study to JSON (mirrors `workPrecisionStudyToJSON`,
 * `work-precision-harness.ts`): the platform-blessed stringification point,
 * and this task's own validation criterion's other half -- the UI's
 * displayed slopes must match what this JSON reports, since both read the
 * same `ConvergenceStudyMethodResult.slope` field.
 */
export function convergenceStudyToJSON(study: ConvergenceStudyResult): string {
  return JSON.stringify(study);
}
