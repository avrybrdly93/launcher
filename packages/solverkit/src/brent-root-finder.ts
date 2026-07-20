const DEFAULT_MAX_ITERATIONS = 100;

/** Outcome of {@link brentRoot}. */
export interface BrentResult {
  /** The localized root (or best estimate if `converged` is false). */
  readonly x: number;
  /** `f(x)`. */
  readonly fx: number;
  /** Number of iterations actually run. */
  readonly iterations: number;
  /** False only if `maxIterations` was exhausted without meeting `tol`. */
  readonly converged: boolean;
}

/**
 * Brent's method (Brent 1973; the safeguarded inverse-quadratic-interpolation
 * / secant / bisection hybrid, per the standard Wikipedia/Numerical-Recipes
 * `zbrent` formulation): finds a root of `f` bracketed by `[a0, b0]`, where
 * `fa0 = f(a0)` and `fb0 = f(b0)` are supplied by the caller (root finders
 * here are always seeded from a bracket whose endpoint values are already
 * known, e.g. {@link scanStepForEvents}'s candidates, so recomputing them
 * would be wasted work). Combines inverse quadratic interpolation / secant
 * steps with a bisection fallback whenever the interpolated step would leave
 * the bracket or fails to make adequate progress, which guarantees
 * convergence at least as fast as bisection while usually converging
 * superlinearly.
 *
 * Generic over any scalar bracketed root problem -- event time localization
 * (§4.9, P2.33) is the first caller, but the same function is meant to be
 * reused by Phase 5's range-matching shooting (P5.03) and other 1D root
 * problems rather than reimplemented per call site.
 *
 * `tol(x)` returns the convergence tolerance appropriate to a candidate
 * root `x` (callers scale it to their own problem's units -- §4.9 specifies
 * `1e2 * eps_mach * t` for event times); iteration stops once the bracket
 * width is within it. `maxIterations` is a hard backstop: if exceeded, the
 * current best estimate is returned with `converged: false` rather than
 * throwing, so a caller can decide how to handle non-convergence.
 */
export function brentRoot(
  f: (x: number) => number,
  a0: number,
  b0: number,
  fa0: number,
  fb0: number,
  tol: (x: number) => number,
  maxIterations = DEFAULT_MAX_ITERATIONS,
): BrentResult {
  if (fa0 === 0) return { x: a0, fx: fa0, iterations: 0, converged: true };
  if (fb0 === 0) return { x: b0, fx: fb0, iterations: 0, converged: true };
  if (fa0 * fb0 > 0) {
    throw new Error("brentRoot: [a0, b0] does not bracket a sign change (f(a0)*f(b0) > 0)");
  }

  let a = a0;
  let b = b0;
  let fa = fa0;
  let fb = fb0;

  // Invariant maintained after every reassignment of (a,b): |f(b)| <= |f(a)|,
  // i.e. b is always the current best estimate.
  if (Math.abs(fa) < Math.abs(fb)) {
    [a, b] = [b, a];
    [fa, fb] = [fb, fa];
  }

  let c = a;
  let fc = fa;
  // Only read when mflag is false, which cannot happen on iteration 1 (the
  // `!mflag && ...` conditions below short-circuit before touching it) --
  // initialized anyway to satisfy strict definite-assignment.
  let d = b - a;
  let mflag = true;

  for (let iter = 1; iter <= maxIterations; iter++) {
    if (fb === 0) return { x: b, fx: fb, iterations: iter - 1, converged: true };

    const tolerance = tol(b);
    if (Math.abs(b - a) <= tolerance) {
      return { x: b, fx: fb, iterations: iter - 1, converged: true };
    }

    let s: number;
    if (fa !== fc && fb !== fc) {
      // Inverse quadratic interpolation through (a,fa), (b,fb), (c,fc).
      s =
        (a * fb * fc) / ((fa - fb) * (fa - fc)) +
        (b * fa * fc) / ((fb - fa) * (fb - fc)) +
        (c * fa * fb) / ((fc - fa) * (fc - fb));
    } else {
      // Secant method through (a,fa), (b,fb).
      s = b - (fb * (b - a)) / (fb - fa);
    }

    const lo = Math.min((3 * a + b) / 4, b);
    const hi = Math.max((3 * a + b) / 4, b);
    const sInRange = s > lo && s < hi;
    const cond2 = mflag && Math.abs(s - b) >= Math.abs(b - c) / 2;
    const cond3 = !mflag && Math.abs(s - b) >= Math.abs(c - d) / 2;
    const cond4 = mflag && Math.abs(b - c) < tolerance;
    const cond5 = !mflag && Math.abs(c - d) < tolerance;

    if (!sInRange || cond2 || cond3 || cond4 || cond5) {
      s = (a + b) / 2;
      mflag = true;
    } else {
      mflag = false;
    }

    const fs = f(s);
    d = c;
    c = b;
    fc = fb;

    if (fa * fs < 0) {
      b = s;
      fb = fs;
    } else {
      a = s;
      fa = fs;
    }

    if (Math.abs(fa) < Math.abs(fb)) {
      [a, b] = [b, a];
      [fa, fb] = [fb, fa];
    }
  }

  return { x: b, fx: fb, iterations: maxIterations, converged: false };
}
