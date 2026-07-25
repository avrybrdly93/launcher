/**
 * Solver Lab comparison harness (§6.3 "distinct route ... side-by-side
 * method comparison against reference solution"; P3.41). Runs Explicit
 * Euler, Classical RK4, and DOPRI5 at a shared fixed step `h` over the
 * scenario's own planar-projectile model to ground impact, alongside a
 * tight-tolerance adaptive DOPRI5 reference solve, and reports each
 * column's global error against that reference (`l2Error` on the full
 * `(x, y, vx, vy)` state at t_f) -- the "error readouts" this task's
 * validation criterion asks for.
 *
 * Mirrors `SimulationSession`'s own `T_MAX_SECONDS` backstop
 * (simulation-session.ts): `resolveModel`'s `planarProjectileModel` always
 * declares a terminal ground-impact event, so every physically sane
 * scenario ends there long before 60s.
 */

import type { ScenarioSpec } from "@ballista/engine";
import {
  HermiteDenseOutputStepper,
  integrate,
  l2Error,
  type SolveReport,
} from "@ballista/solverkit";
import { resolveModel, resolveStepper } from "./scenario-resolver.js";

const T_MAX_SECONDS = 60;

/** `stepper.id` -> a stepper resolvable via `resolveStepper` (scenario-resolver.ts). */
const REFERENCE_STEPPER_ID = "dopri5";

/**
 * Tight enough that the reference solve's own truncation error is
 * negligible next to the fixed-step columns' (h on the order of 1e-2 -
 * 1e-1s), so the columns' `errorVsReference` is dominated by their own
 * method error, not reference noise.
 */
const REFERENCE_RTOL = 1e-12;
const REFERENCE_ATOL = 1e-12;

/** The three methods the Solver Lab's comparison route displays as columns, in display order. */
export const SOLVER_LAB_COLUMN_STEPPERS: readonly {
  readonly id: string;
  readonly label: string;
}[] = [
  { id: "explicit-euler", label: "Explicit Euler" },
  { id: "classical-rk4", label: "Classical RK4" },
  { id: "dopri5", label: "Dormand-Prince 5(4)" },
];

/** One method's result column: its own solve outcome plus its global error against the reference. */
export interface SolverLabColumn {
  readonly stepperId: string;
  readonly label: string;
  readonly h: number;
  readonly status: SolveReport["status"];
  readonly tFinal: number;
  readonly yFinal: Float64Array;
  readonly nSteps: number;
  readonly nRHS: number;
  readonly errorVsReference: number;
}

/** Full Solver Lab comparison: the reference solve plus every column measured against it. */
export interface SolverLabComparison {
  readonly referenceStepperId: string;
  readonly referenceYFinal: Float64Array;
  readonly referenceTFinal: number;
  readonly h: number;
  readonly columns: readonly SolverLabColumn[];
}

/**
 * Runs the Solver Lab comparison for `spec` at fixed step `h` (default:
 * the scenario's own configured `h`, falling back to 0.01s for a scenario
 * whose default stepper is adaptive and so carries no `h`).
 */
export function runSolverLabComparison(
  spec: ScenarioSpec,
  h: number = spec.solver.h ?? 0.01,
): SolverLabComparison {
  const { model, ctx, y0 } = resolveModel(spec);

  const referenceStepper = resolveStepper(REFERENCE_STEPPER_ID);
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

  const columns = SOLVER_LAB_COLUMN_STEPPERS.map(({ id, label }): SolverLabColumn => {
    const resolvedStepper = resolveStepper(id);
    // Every v1 fixed-step method (Euler, RK4) carries no dense-output
    // interpolant of its own (only dopri5 does) -- without one, `integrate`
    // can't scan for the model's terminal ground-impact event, so the
    // column would run to the T_MAX_SECONDS backstop instead of landing
    // (mirrors `SimulationSession.commitScenario`'s identical decoration).
    const stepper = resolvedStepper.interpolant
      ? resolvedStepper
      : new HermiteDenseOutputStepper(resolvedStepper);
    const report = integrate(
      model,
      ctx,
      y0,
      [0, T_MAX_SECONDS],
      {
        stepper: id,
        h,
        maxSteps: Number.MAX_SAFE_INTEGER,
      },
      stepper,
    );

    return {
      stepperId: id,
      label,
      h,
      status: report.status,
      tFinal: report.tFinal,
      yFinal: report.yFinal,
      nSteps: report.nSteps,
      nRHS: report.nRHS,
      errorVsReference: l2Error(report.yFinal, referenceReport.yFinal),
    };
  });

  return {
    referenceStepperId: REFERENCE_STEPPER_ID,
    referenceYFinal: referenceReport.yFinal,
    referenceTFinal: referenceReport.tFinal,
    h,
    columns,
  };
}
