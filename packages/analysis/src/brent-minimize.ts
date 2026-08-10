/**
 * The 1D minimizers of §7 Phase 5 (P5.13): golden-section search and Brent's
 * `localmin`, both operating on a caller-supplied interval that is assumed to
 * contain one interior minimum.
 *
 * **They live here rather than in `solverkit` on the blueprint's authority, not
 * a preference.** Line 1153 groups "derivative-free (Nelder–Mead,
 * golden-section)" as the optimization kit, and line 119 assigns optimization
 * to this package. `brent-root-finder.ts` staying in `solverkit` alongside the
 * linear algebra is therefore the intended split — root-finding and linear
 * algebra there, optimization here — and not an oversight to be tidied up. The
 * two Brents are also genuinely different algorithms that happen to share an
 * author and a safeguarding idea: one contracts a *sign-change* bracket using
 * inverse quadratic interpolation through three `(x, f)` pairs, the other
 * contracts an *interval* using a parabola fitted to three points to find a
 * stationary point. Neither is expressible in terms of the other.
 *
 * **The precision floor is the thing to understand before reading the
 * criterion.** P5.13's validation asks for "unimodal test functions to 1e-10",
 * and that is comfortably achievable on the objective *value* while being, for
 * some functions, unreachable on the *location* — so the tests measure the two
 * separately instead of asserting one number over cases where it means
 * different things. Near a smooth interior minimum,
 *
 *     f(x) ≈ f(x*) + ½ f''(x*) (x − x*)²
 *
 * so a displacement `δ` changes `f` by `O(δ²)` while the rounding error in
 * evaluating `f` stays at `O(ε_mach · |f(x*)|)`. A method that can only
 * *compare* values loses the ability to tell two points apart once the first
 * drops below the second:
 *
 *     δ_floor ≈ √( 2 ε_mach |f(x*)| / f''(x*) )
 *
 * **Note what is and is not in that expression.** The floor scales with
 * `√|f(x*)|` — the size of the value being cancelled against — and not with
 * `|x*|`, which is the folklore version and is wrong. A minimum whose value is
 * `0` has *no* floor at all, because there is nothing for the quadratic term to
 * be swamped by: `(x − 1.3)⁴` and `|x − 0.3|` are both located to the last bit
 * here, while `−cos(x)` (value `−1`, curvature `1`) saturates at `2e-8` however
 * hard it is pushed. `brent-minimize.test.ts` asserts this formula against
 * measured error on five functions rather than leaving it as a comment.
 *
 * **{@link brentMinimize} routinely beats that floor, and it is worth being
 * clear about why**, since "you cannot do better than √ε" is usually stated
 * without the caveat. The floor binds methods that only compare. Parabolic
 * interpolation instead *fits* three points, and it can place them outside the
 * flat region where the values still carry information, so the vertex it
 * computes is far more accurate than any comparison between points near it —
 * on an exactly quadratic objective it is the answer, to the last bit, from any
 * three points at all. In measurement, Brent lands one to three orders of
 * magnitude inside the floor that stops {@link goldenSectionMinimize} dead.
 * That is the concrete reason to prefer it on smooth problems, over and above
 * costing a third of the evaluations.
 *
 * Asking either function for an x-tolerance below its problem's floor is not an
 * error and does not fail: it spends extra iterations contracting an interval
 * over rounding noise and returns a point no better than the one it already
 * had. {@link DEFAULT_X_TOL_RELATIVE} is set to `√ε_mach` because that is the
 * right order for an `O(1)`-valued objective, which is the common case; a
 * caller who knows its minimum value is near zero should tighten it and will be
 * repaid.
 *
 * **One consequence a caller minimizing a kinked objective needs, because the
 * default is wrong for it.** The two regimes trade places exactly. At a smooth
 * minimum the value converges quadratically in `δ`, so the default tolerance
 * delivers a value accurate to `~1e-17` while the location saturates. At a kink
 * the value converges only linearly, so the *same* default tolerance leaves the
 * value off by `O(√ε |x*|)` — around `4e-9`, a hundred times worse than 1e-10 —
 * while the location has no floor at all. So: **tighten
 * {@link Minimize1DOptions.xTolAbsolute} when the objective has a kink at its
 * minimum, and do not bother when it is smooth.** The tests assert both halves.
 *
 * **Which one to call.** {@link brentMinimize} is the default: on a smooth
 * objective its parabolic steps converge superlinearly and it typically needs a
 * third to a half of golden section's evaluations for the same interval.
 * {@link goldenSectionMinimize} earns its place when the objective is noisy,
 * kinked, or piecewise — a parabola fitted through three points of a jagged
 * function proposes nonsense, and while Brent's safeguard catches it and falls
 * back, the fallback costs an evaluation that pure contraction never wastes.
 * Golden section also contracts the interval by a fixed factor every iteration
 * regardless of what `f` does, which makes its evaluation count predictable in
 * advance — worth something when each evaluation flies a trajectory.
 *
 * Neither function brackets for you. Both take `[a, b]` the way
 * `brentRoot` takes its sign-change bracket, because the callers in this
 * package establish brackets from problem structure — a range peak, an arc
 * envelope — and a generic expansion search would be both slower and less
 * reliable than what they already know.
 */

/**
 * A scalar objective in one variable.
 *
 * A non-finite return (`NaN`, `±Infinity`) is read as `+Infinity` — "this point
 * is not admissible" — matching {@link ObjectiveFunction}'s convention in
 * `nelder-mead.ts`, so an objective may reject a sub-interval by returning
 * `NaN` and the search will contract away from it. A search that never finds a
 * finite value reports {@link Minimize1DStatus} `"evaluation-failed"` rather
 * than returning a meaningless point.
 */
export type ScalarObjective = (x: number) => number;

/**
 * `√ε_mach ≈ 1.49e-8`: the tightest x-tolerance that means anything at a smooth
 * minimum, per the module note above.
 */
export const SQRT_EPSILON = Math.sqrt(Number.EPSILON);

/** Default {@link Minimize1DOptions.xTolRelative} — the smooth-minimum floor. */
export const DEFAULT_X_TOL_RELATIVE = SQRT_EPSILON;

/**
 * Default {@link Minimize1DOptions.xTolAbsolute}.
 *
 * A relative tolerance alone degenerates to zero at `x* = 0` and the search
 * would then run to `maxIterations` on a perfectly ordinary problem, so the
 * effective tolerance is always `xTolRelative·|x| + xTolAbsolute`. The default
 * is deliberately far below the smooth-minimum floor at any `|x| ≳ 1e-4`, so it
 * only takes over near the origin.
 */
export const DEFAULT_X_TOL_ABSOLUTE = 1e-12;

const DEFAULT_MAX_ITERATIONS = 200;

/** `(√5 − 1)/2 ≈ 0.618`: the golden-section interval retention factor. */
const INVERSE_GOLDEN = (Math.sqrt(5) - 1) / 2;

/** `(3 − √5)/2 ≈ 0.382`: the complementary fraction, `1 − INVERSE_GOLDEN`. */
const GOLDEN_COMPLEMENT = (3 - Math.sqrt(5)) / 2;

/** Why a 1D minimization stopped. */
export type Minimize1DStatus =
  /** The bracket contracted within the effective x-tolerance. */
  | "converged"
  /** {@link Minimize1DOptions.maxIterations} ran out first. */
  | "max-iterations"
  /** No point evaluated anywhere in the interval had a finite value. */
  | "evaluation-failed";

/** Tuning for {@link goldenSectionMinimize} and {@link brentMinimize}. */
export interface Minimize1DOptions {
  /**
   * Relative x-tolerance; the effective tolerance at a candidate `x` is
   * `xTolRelative·|x| + xTolAbsolute`. Defaults to
   * {@link DEFAULT_X_TOL_RELATIVE}. Values below it are accepted and are not
   * an error, but buy nothing at a smooth minimum — see the module note.
   */
  readonly xTolRelative?: number;
  /** Absolute x-tolerance floor. Defaults to {@link DEFAULT_X_TOL_ABSOLUTE}. */
  readonly xTolAbsolute?: number;
  /** Hard backstop. Defaults to 200, which no well-posed bracket approaches. */
  readonly maxIterations?: number;
}

/** Outcome of a 1D minimization. */
export interface Minimize1DResult {
  /** The minimizer estimate. */
  readonly x: number;
  /**
   * `f(x)`, always a value this function actually evaluated rather than an
   * interpolation, and always the lowest such value seen.
   */
  readonly fx: number;
  /** Iterations run. */
  readonly iterations: number;
  /** Objective evaluations spent, the cost that matters when `f` integrates. */
  readonly evaluations: number;
  /**
   * The final interval, `[lo, hi]`, still containing the minimum. Its width is
   * the honest uncertainty on {@link x} — report it rather than assuming the
   * requested tolerance was achieved, since a run that stopped on
   * `"max-iterations"` did not achieve it.
   */
  readonly bracket: readonly [number, number];
  /** Why it stopped. */
  readonly status: Minimize1DStatus;
  /** Convenience for `status === "converged"`. */
  readonly converged: boolean;
}

/** Reads a non-finite objective value as "inadmissible" per {@link ScalarObjective}. */
function admissible(value: number): number {
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function requireOrderedBracket(name: string, a: number, b: number): void {
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    throw new Error(`${name}: bracket [${a}, ${b}] must be finite`);
  }
  if (!(a < b)) {
    throw new Error(`${name}: bracket [${a}, ${b}] must satisfy a < b`);
  }
}

function resolveOptions(options: Minimize1DOptions | undefined): {
  xTolRelative: number;
  xTolAbsolute: number;
  maxIterations: number;
} {
  return {
    xTolRelative: options?.xTolRelative ?? DEFAULT_X_TOL_RELATIVE,
    xTolAbsolute: options?.xTolAbsolute ?? DEFAULT_X_TOL_ABSOLUTE,
    maxIterations: options?.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  };
}

/**
 * Golden-section search: contracts `[a, b]` by the fixed factor
 * `(√5 − 1)/2 ≈ 0.618` per iteration, keeping the sub-interval whose interior
 * probe was lower.
 *
 * **The golden ratio is not decoration.** Placing the two interior probes at
 * that ratio is the unique choice under which the surviving probe lands at the
 * correct ratio *inside the new interval*, so every iteration after the first
 * costs exactly one new evaluation instead of two. Any other split throws away
 * an evaluation per step.
 *
 * Guarantees the interval shrinks by the same factor whatever `f` does, which
 * is what makes it the right choice on noisy or kinked objectives where a
 * fitted parabola is meaningless. The price is linear convergence: reaching a
 * tolerance `τ` from a width `w` costs `ln(w/τ)/ln(1/0.618) ≈ 2.08·ln(w/τ)`
 * evaluations, with no speed-up as it closes in.
 *
 * Assumes one interior minimum on `[a, b]`. Given a multimodal interval it
 * still converges — to *a* local minimum, chosen by which probe happened to be
 * lower, with no indication that others exist.
 */
export function goldenSectionMinimize(
  f: ScalarObjective,
  a0: number,
  b0: number,
  options?: Minimize1DOptions,
): Minimize1DResult {
  requireOrderedBracket("goldenSectionMinimize", a0, b0);
  const { xTolRelative, xTolAbsolute, maxIterations } = resolveOptions(options);

  let a = a0;
  let b = b0;
  let evaluations = 0;

  const evaluate = (x: number): number => {
    evaluations += 1;
    return admissible(f(x));
  };

  let c = b - INVERSE_GOLDEN * (b - a);
  let d = a + INVERSE_GOLDEN * (b - a);
  let fc = evaluate(c);
  let fd = evaluate(d);

  let iterations = 0;
  let status: Minimize1DStatus = "max-iterations";

  while (iterations < maxIterations) {
    const midpoint = (a + b) / 2;
    if (b - a <= xTolRelative * Math.abs(midpoint) + xTolAbsolute) {
      status = "converged";
      break;
    }
    iterations += 1;

    // Ties go left, which matters only for a flat minimum and keeps the search
    // deterministic when it happens.
    if (fc <= fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INVERSE_GOLDEN * (b - a);
      fc = evaluate(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INVERSE_GOLDEN * (b - a);
      fd = evaluate(d);
    }
  }

  // The answer is chosen from the three candidates that are still *inside* the
  // final interval -- the two surviving probes and its midpoint -- rather than
  // from the lowest value seen anywhere. Those differ, and the difference shows
  // up exactly where this matters: at a minimum flat enough that every nearby
  // point returns the identical double, a running "best seen" latches onto
  // whichever point reached that value first and can end up outside the
  // interval the search has since contracted to, so the result would report an
  // `x` its own `bracket` excludes. Under the unimodality this function assumes,
  // the survivors are the best points anyway. The midpoint costs one evaluation
  // and is the better location estimate, so it wins ties.
  const finalMidpoint = (a + b) / 2;
  let x = finalMidpoint;
  let fx = evaluate(finalMidpoint);
  if (fc < fx) {
    x = c;
    fx = fc;
  }
  if (fd < fx) {
    x = d;
    fx = fd;
  }

  if (!Number.isFinite(fx)) {
    return {
      x: finalMidpoint,
      fx: Number.POSITIVE_INFINITY,
      iterations,
      evaluations,
      bracket: [a, b],
      status: "evaluation-failed",
      converged: false,
    };
  }

  return {
    x,
    fx,
    iterations,
    evaluations,
    bracket: [a, b],
    status,
    converged: status === "converged",
  };
}

/**
 * Brent's `localmin` (Brent 1973 ch. 5; the parabolic-interpolation /
 * golden-section hybrid, in the standard `Numerical Recipes` `brent`
 * formulation): fits a parabola through the three best points seen and steps to
 * its vertex, falling back to a golden-section step whenever that vertex is
 * untrustworthy.
 *
 * **The safeguard is the algorithm.** Pure parabolic interpolation on a smooth
 * function converges superlinearly and on a genuinely quadratic one lands on
 * the minimum in a single step — but the same fit through three nearly-collinear
 * points, or three points straddling a kink, proposes a vertex outside the
 * interval or barely distinguishable from the current point, and iterating on
 * that stalls or diverges. A step is therefore rejected, and replaced by golden
 * section, unless it (1) lands strictly inside the current interval and (2)
 * moves less than half the *step before last*. That second condition is the
 * subtle one: it forces the steps to keep shrinking, so a sequence of
 * technically-legal interpolations that each barely move cannot stall the
 * search. What survives is golden section's guaranteed interval contraction
 * with parabolic speed whenever the function is locally well-approximated by a
 * quadratic — which, near a smooth interior minimum, it eventually always is.
 *
 * Same contract as {@link goldenSectionMinimize}: `[a0, b0]` is assumed to
 * contain one interior minimum, and the same precision floor applies.
 */
export function brentMinimize(
  f: ScalarObjective,
  a0: number,
  b0: number,
  options?: Minimize1DOptions,
): Minimize1DResult {
  requireOrderedBracket("brentMinimize", a0, b0);
  const { xTolRelative, xTolAbsolute, maxIterations } = resolveOptions(options);

  let a = a0;
  let b = b0;
  let evaluations = 0;

  const evaluate = (at: number): number => {
    evaluations += 1;
    return admissible(f(at));
  };

  // x: best point so far; w: second best; v: previous value of w.
  let x = a + GOLDEN_COMPLEMENT * (b - a);
  let w = x;
  let v = x;
  let fx = evaluate(x);
  let fw = fx;
  let fv = fx;

  // `d` is the step just taken, `e` the one before it -- the "step before last"
  // the acceptance test above measures against. `e = 0` on entry forces the
  // first move to be golden section, since one point cannot define a parabola.
  let d = 0;
  let e = 0;

  let iterations = 0;
  let status: Minimize1DStatus = "max-iterations";

  while (iterations < maxIterations) {
    const midpoint = (a + b) / 2;
    const tol1 = xTolRelative * Math.abs(x) + xTolAbsolute;
    const tol2 = 2 * tol1;

    // Brent's termination test, which is tighter than `b - a <= tol2`: it stops
    // as soon as `x` is within `tol1` of *both* ends' implied uncertainty,
    // rather than waiting for the whole interval to shrink symmetrically.
    if (Math.abs(x - midpoint) <= tol2 - (b - a) / 2) {
      status = "converged";
      break;
    }
    iterations += 1;

    let useGolden = true;
    if (Math.abs(e) > tol1) {
      // Parabola through (x, fx), (w, fw), (v, fv); vertex at x + p/q.
      const r = (x - w) * (fx - fv);
      let q = (x - v) * (fx - fw);
      let p = (x - v) * q - (x - w) * r;
      q = 2 * (q - r);
      if (q > 0) p = -p;
      q = Math.abs(q);
      const ePrevious = e;
      e = d;

      const stepTooLarge = Math.abs(p) >= Math.abs(q * ePrevious) / 2;
      const outsideBracket = p <= q * (a - x) || p >= q * (b - x);
      if (!stepTooLarge && !outsideBracket && q !== 0) {
        d = p / q;
        const u = x + d;
        // Never step so close to an end that the next parabola is fitted to
        // three points crowded against it.
        if (u - a < tol2 || b - u < tol2) {
          d = midpoint - x >= 0 ? tol1 : -tol1;
        }
        useGolden = false;
      }
    }

    if (useGolden) {
      e = x >= midpoint ? a - x : b - x;
      d = GOLDEN_COMPLEMENT * e;
    }

    // Never evaluate closer than tol1 to x: inside that radius the two values
    // are indistinguishable and the comparison below would be reading noise.
    const u = Math.abs(d) >= tol1 ? x + d : x + (d >= 0 ? tol1 : -tol1);
    const fu = evaluate(u);

    if (fu <= fx) {
      if (u >= x) a = x;
      else b = x;
      v = w;
      fv = fw;
      w = x;
      fw = fx;
      x = u;
      fx = fu;
    } else {
      if (u < x) a = u;
      else b = u;
      if (fu <= fw || w === x) {
        v = w;
        fv = fw;
        w = u;
        fw = fu;
      } else if (fu <= fv || v === x || v === w) {
        v = u;
        fv = fu;
      }
    }
  }

  if (!Number.isFinite(fx)) {
    return {
      x,
      fx: Number.POSITIVE_INFINITY,
      iterations,
      evaluations,
      bracket: [a, b],
      status: "evaluation-failed",
      converged: false,
    };
  }

  return {
    x,
    fx,
    iterations,
    evaluations,
    bracket: [a, b],
    status,
    converged: status === "converged",
  };
}
