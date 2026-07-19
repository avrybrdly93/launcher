import type { EvalContext, Model } from "@ballista/engine";
import { integrate } from "./integrate.js";
import type { Stepper } from "./types.js";

/** Result of {@link measureConvergence}: the (h, error) samples and the fitted log-log slope. */
export interface ConvergenceResult {
  readonly hs: readonly number[];
  readonly errors: readonly number[];
  /** Least-squares slope of log(error) vs log(h) -- the method's observed order. */
  readonly slope: number;
}

/** Euclidean norm of the difference between two same-length state vectors. */
export function l2Error(numeric: Float64Array, exact: Float64Array): number {
  let sumSq = 0;
  for (let i = 0; i < numeric.length; i++) {
    const d = numeric[i]! - exact[i]!;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq);
}

/** Least-squares slope of y = slope*x + intercept, i.e. cov(x,y)/var(x). */
function fitSlope(xs: readonly number[], ys: readonly number[]): number {
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
  return covariance / variance;
}

/**
 * Convergence-rate harness (§5.1, §8.2): runs `model` with a fresh
 * `createStepper()` instance at each h in `hs`, measures the global error
 * against `yExact(t_f)` at the end of `tspan`, and fits the slope of
 * log(error) vs log(h) -- the method's observed order of convergence. A
 * fresh stepper per h avoids relying on a stepper's `init` being safe to
 * call more than once.
 */
export function measureConvergence(
  createStepper: () => Stepper,
  model: Model,
  ctx: EvalContext,
  y0: Float64Array,
  tspan: readonly [number, number],
  yExact: (t: number) => Float64Array,
  hs: readonly number[],
  errorNorm: (numeric: Float64Array, exact: Float64Array) => number = l2Error,
): ConvergenceResult {
  const exactAtTFinal = yExact(tspan[1]);

  const errors = hs.map((h) => {
    const stepper = createStepper();
    const report = integrate(
      model,
      ctx,
      y0,
      tspan,
      { stepper: stepper.info.id, h, maxSteps: Number.MAX_SAFE_INTEGER },
      stepper,
      [],
    );
    return errorNorm(report.yFinal, exactAtTFinal);
  });

  const slope = fitSlope(
    hs.map((h) => Math.log(h)),
    errors.map((e) => Math.log(e)),
  );

  return { hs, errors, slope };
}
