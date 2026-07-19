import type { EvalContext, Model } from "@ballista/engine";
import { l2Error } from "./convergence-harness.js";
import { integrate } from "./integrate.js";
import type { Stepper } from "./types.js";

/** One (h, cost, accuracy) sample of a {@link WorkPrecisionCurve}. */
export interface WorkPrecisionPoint {
  readonly h: number;
  /** rhs evaluations consumed reaching t_f -- the platform's cost metric (§5.1, `SolveReport.nRHS`). */
  readonly nRHS: number;
  readonly error: number;
}

/** A single method's error-vs-cost curve, ready for the Solver Lab work-precision plot (§4, §7 P2.19). */
export interface WorkPrecisionCurve {
  readonly method: string;
  readonly points: readonly WorkPrecisionPoint[];
}

/**
 * Work-precision harness (§4 pedagogy, P2.19): runs `createStepper()` at
 * each h in `hs`, pairing the method's cost (`SolveReport.nRHS`, not step
 * count -- what makes a 4-stage RK4 step comparable to four 1-stage Euler
 * steps) against its global error at t_f vs `yExact`. This is the same
 * measurement `measureConvergence` (P2.07) makes plus cost accounting, so a
 * method's curve can be compared against another method's on an
 * accuracy-per-rhs-evaluation basis rather than accuracy-per-step, which is
 * how higher-order methods actually win a fair comparison.
 */
export function measureWorkPrecision(
  createStepper: () => Stepper,
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  yExact: (t: number) => Float64Array,
  hs: readonly number[],
  errorNorm: (numeric: Float64Array, exact: Float64Array) => number = l2Error,
): WorkPrecisionCurve {
  const exactAtTFinal = yExact(tspan[1]);
  const method = createStepper().info.id;

  const points = hs.map((h) => {
    const stepper = createStepper();
    const report = integrate(
      model,
      ctx,
      y0,
      tspan,
      { stepper: stepper.info.id, h, maxSteps: Number.MAX_SAFE_INTEGER },
      stepper,
    );
    return {
      h,
      nRHS: report.nRHS,
      error: errorNorm(report.yFinal, exactAtTFinal),
    };
  });

  return { method, points };
}

/** Runs {@link measureWorkPrecision} for each of `methods` against the same problem. */
export function runWorkPrecisionStudy(
  methods: readonly (() => Stepper)[],
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  yExact: (t: number) => Float64Array,
  hs: readonly number[],
  errorNorm?: (numeric: Float64Array, exact: Float64Array) => number,
): readonly WorkPrecisionCurve[] {
  return methods.map((createStepper) =>
    measureWorkPrecision(createStepper, model, ctx, y0, tspan, yExact, hs, errorNorm),
  );
}

/**
 * Log-log linear fit of a curve's (nRHS, error) points, solved for the
 * nRHS at a given target error -- the x-axis position of a fixed y=error
 * horizontal line on a Work-Precision plot (§4). Every non-adaptive method
 * measured here has error ~ C * nRHS^(-order) over its convergent range, a
 * straight line in log-log space, so this interpolates (or modestly
 * extrapolates, for a target just outside the measured range) along that
 * line rather than requiring a measured point land exactly on the target.
 */
export function nRHSAtTargetError(curve: WorkPrecisionCurve, targetError: number): number {
  const xs = curve.points.map((p) => Math.log(p.nRHS));
  const ys = curve.points.map((p) => Math.log(p.error));
  const n = xs.length;
  const meanX = xs.reduce((a, b) => a + b, 0) / n;
  const meanY = ys.reduce((a, b) => a + b, 0) / n;
  let covariance = 0;
  let variance = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    covariance += dx * (ys[i]! - meanY);
    variance += dx * dx;
  }
  const slope = covariance / variance;
  const intercept = meanY - slope * meanX;
  return Math.exp((Math.log(targetError) - intercept) / slope);
}

/**
 * Serializes a work-precision study to JSON (P2.19's "JSON output"): the
 * curves are already plain data, so this is the platform-blessed
 * stringification point rather than every caller (CI artifact, Solver Lab
 * fetch) reaching for `JSON.stringify` itself.
 */
export function workPrecisionStudyToJSON(curves: readonly WorkPrecisionCurve[]): string {
  return JSON.stringify(curves);
}
