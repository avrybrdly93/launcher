import {
  DEFAULT_X_TOL_ABSOLUTE,
  DEFAULT_X_TOL_RELATIVE,
  type Minimize1DStatus,
  brentMinimize,
} from "./brent-minimize.js";
import { DRAG_FREE_PEAK_ANGLE, type RangeFunction } from "./range-root.js";

/**
 * The optimal-elevation problem of §7 Phase 5 (P5.14): `argmax_θ R(θ)`, and the
 * quantitative answer to the 45° folklore.
 *
 * **The folklore, and exactly how far it is true.** For a drag-free ground
 * launch the range is `v₀² sin(2θ)/g` and the optimum is π/4 — exactly,
 * independent of speed and of `g`. Both premises are load-bearing and both fail
 * in practice. With quadratic drag the optimum moves *below* π/4, and the
 * further into the drag-dominated regime the shot is, the further it moves; a
 * launch that is raised or lands high also peaks below π/4, for a separate
 * reason. So 45° is not an approximation that degrades gracefully — it is the
 * answer to a different problem, and the size of the discrepancy is the thing
 * worth measuring.
 *
 * **Why the optimum drops with drag, in one sentence**, because the shape of the
 * answer is more useful than the number: lofting buys hang time at the cost of
 * horizontal speed, and drag makes the horizontal speed expensive to keep, so
 * the trade tips towards a flatter, faster arc that spends less time being
 * decelerated. The measured shift is in `optimal-angle.test.ts`, tabulated
 * against the drag-to-gravity group Π = ρ·C_d·A·v₀²/(2·m·g) that
 * `@ballista/engine`'s `dimensionlessPi` defines.
 *
 * **What is new here, and what is reused.** The search itself is not new: this
 * module brackets the maximum with a coarse sweep and hands the bracket to
 * P5.13's {@link brentMinimize}, which is the consumer that module was written
 * for — `range-root.ts`'s {@link DRAG_FREE_PEAK_ANGLE} doc says as much
 * ("computing the peak for the general case is P5.09's reachability envelope and
 * P5.13's 1D minimizer, not this task's work"). What is new is the *problem*:
 * that `R(θ)` is a maximization rather than a minimization, that it is only
 * unimodal on the interval where the shot actually lands, that an inadmissible
 * aim has to be distinguished from a genuinely short one, and that an optimum
 * pinned to an angle bound is a different answer from an interior one and must
 * not be reported as though it were the peak.
 *
 * `RangeFunction` is taken as a parameter for the same reason `range-root.ts`
 * takes it: the drag-free closed form is what the tests validate against, not
 * what the code is for. Callers with drag pass an integrated range.
 */

/**
 * Sentinel a {@link RangeFunction} may return for an aim that does not produce
 * an impact at all — a shot that never comes down inside the integration span,
 * or one the model rejects.
 *
 * This matches what `envelope.ts`'s sampler already returns from `rangeAt` for
 * a non-landing aim, so an integrated range function written for the envelope
 * can be handed straight to {@link maximizeRange}. `NaN` is accepted too, via
 * {@link brentMinimize}'s inadmissibility convention.
 */
export const NO_IMPACT = Number.NEGATIVE_INFINITY;

/** Tuning for {@link maximizeRange}. */
export interface OptimalAngleOptions {
  /** Lowest elevation considered, in radians. Default `0`. */
  readonly minAngle?: number;
  /** Highest elevation considered, in radians. Default `π/2`. */
  readonly maxAngle?: number;
  /**
   * Points in the coarse sweep that brackets the maximum, `>= 3`. Default `25`.
   *
   * This is the expensive knob when the range function integrates: the sweep
   * costs exactly this many evaluations before refinement starts. 25 over
   * `[0, π/2]` is a spacing of 3.75°, comfortably finer than the width of the
   * peak for any regime this project simulates — the flattest optima measured in
   * `optimal-angle.test.ts` still lose over 1% of their range 10° away.
   *
   * It is *not* a tolerance. Raising it does not improve the answer, which comes
   * from the refinement; it only guards against a sweep so coarse that it
   * brackets the wrong hump on a multimodal range curve (terrain can do that —
   * see the caveat on {@link OptimalAngle.bracket}).
   */
  readonly sweepSamples?: number;
  /**
   * Absolute tolerance on θ, in radians, handed to {@link brentMinimize} as its
   * `xTolAbsolute`. Default {@link DEFAULT_X_TOL_ABSOLUTE} (`1e-12`).
   *
   * Read {@link OptimalAngle.theta}'s note before tightening this: at a smooth
   * maximum the *location* cannot be resolved below roughly
   * `√(2ε·R(θ*)/|R''(θ*)|)`, which for a 100 m shot is around `1e-4` rad, so a
   * request finer than that is met by the bracket without being met by the
   * answer. It is left at the minimizer's default rather than raised to that
   * floor so the floor stays a measured property of the problem instead of
   * something this module asserts about every caller's problem.
   */
  readonly angleTol?: number;
  /** Relative tolerance on θ, handed through. Default {@link DEFAULT_X_TOL_RELATIVE}. */
  readonly angleTolRelative?: number;
  /** Refinement iteration backstop. Default `100`. */
  readonly maxIterations?: number;
}

/** Why {@link maximizeRange} stopped, extending {@link Minimize1DStatus}. */
export type OptimalAngleStatus =
  | Minimize1DStatus
  /**
   * The best point in the sweep was an endpoint of the angle bounds, so no
   * interior maximum was bracketed and no refinement was attempted. The
   * reported θ is that bound.
   */
  | "at-bound"
  /** No aim in the bounds produced an impact. */
  | "no-impact";

/** The maximum-range aim, and what is known about it. */
export interface OptimalAngle {
  /**
   * The optimal elevation, in radians.
   *
   * **This is resolved far less precisely than the range at it, and the
   * asymmetry is inherent rather than a defect of the method.** Near a smooth
   * maximum `R(θ* + δ) ≈ R(θ*) − ½|R''|δ²`, so a δ of `1e-4` rad costs about
   * `1e-8` of relative range — which is to say the range is flat enough there
   * that any value-comparing search stops being able to tell two angles apart
   * long before their difference is small. {@link bracket} is the honest
   * uncertainty; `brent-minimize.ts`'s module note derives the floor.
   *
   * The practical reading is the useful one: the peak is *broad*, so an aim a
   * degree off the optimum is not meaningfully worse, and the exact optimum
   * matters much less than knowing it is not 45°.
   */
  readonly theta: number;
  /** `R(θ)` there, in metres — the maximum range. */
  readonly range: number;
  /**
   * The final bracket on θ, `[lo, hi]`, in radians. Its width is the
   * uncertainty on {@link theta}; for `"at-bound"` it is the degenerate
   * `[θ, θ]`.
   *
   * **Only meaningful as a global answer if `R` is unimodal on the bounds**,
   * which drag alone does not break but terrain can: a range curve over a slope
   * or a step can have two humps, and a bracketing search converges to whichever
   * one the sweep found, with nothing in this result indicating the other exists.
   * Flat-ground callers are safe; terrain callers should sweep and inspect.
   */
  readonly bracket: readonly [number, number];
  /** Sweep evaluations spent bracketing. */
  readonly sweepEvaluations: number;
  /** Refinement evaluations spent, `0` for `"at-bound"` and `"no-impact"`. */
  readonly refineEvaluations: number;
  /** Total range-function calls — the cost that matters when `R` integrates. */
  readonly evaluations: number;
  /** Refinement iterations. */
  readonly iterations: number;
  /** Why it stopped. */
  readonly status: OptimalAngleStatus;
  /** `status === "converged"`. Note `"at-bound"` is a valid answer and is not this. */
  readonly converged: boolean;
  /**
   * `theta − π/4`, in radians: the signed departure from the drag-free
   * folklore. Negative for every quadratic-drag ground launch.
   */
  readonly shiftFromDragFree: number;
}

const DEFAULT_SWEEP_SAMPLES = 25;
const DEFAULT_MAX_ITERATIONS = 100;

interface Resolved {
  minAngle: number;
  maxAngle: number;
  sweepSamples: number;
  angleTol: number;
  angleTolRelative: number;
  maxIterations: number;
}

function resolve(options: OptimalAngleOptions): Resolved {
  const minAngle = options.minAngle ?? 0;
  const maxAngle = options.maxAngle ?? Math.PI / 2;
  const sweepSamples = options.sweepSamples ?? DEFAULT_SWEEP_SAMPLES;

  if (!Number.isFinite(minAngle) || !Number.isFinite(maxAngle)) {
    throw new Error(`maximizeRange: angle bounds [${minAngle}, ${maxAngle}] must be finite`);
  }
  if (!(minAngle < maxAngle)) {
    throw new Error(
      `maximizeRange: angle bounds [${minAngle}, ${maxAngle}] must satisfy minAngle < maxAngle`,
    );
  }
  if (!Number.isInteger(sweepSamples) || sweepSamples < 3) {
    throw new Error(
      `maximizeRange: sweepSamples must be an integer >= 3 (two ends and one interior point are ` +
        `the minimum that can bracket a maximum); got ${sweepSamples}`,
    );
  }
  return {
    minAngle,
    maxAngle,
    sweepSamples,
    angleTol: options.angleTol ?? DEFAULT_X_TOL_ABSOLUTE,
    angleTolRelative: options.angleTolRelative ?? DEFAULT_X_TOL_RELATIVE,
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  };
}

/** A landing aim's range, or `-Infinity` for anything a caller may hand back for a non-impact. */
function landedRange(range: RangeFunction, theta: number): number {
  const value = range(theta);
  return Number.isFinite(value) ? value : Number.NEGATIVE_INFINITY;
}

interface Bracket {
  /** Index of the best sweep sample. */
  readonly bestIndex: number;
  readonly bestAngle: number;
  readonly bestRange: number;
  /** Neighbouring sample angles, the bracket handed to refinement. */
  readonly lo: number;
  readonly hi: number;
  /** False when the best sample was an endpoint of the sweep. */
  readonly interior: boolean;
  readonly evaluations: number;
}

/**
 * Coarse sweep, returning the best sample and its two neighbours.
 *
 * The neighbours are the bracket because a *sampled* maximum at index `i`
 * guarantees `R(θ_i) >= R(θ_{i±1})`, which is exactly the three-point condition
 * a bracketing minimizer needs — no more, and in particular not that the true
 * maximum lies within any tighter interval.
 *
 * Ties go to the first sample seen, which is arbitrary but deterministic. A tie
 * on a genuinely flat top is harmless: the neighbours still bracket it, and
 * refinement lands somewhere on the flat, which is a correct answer to a
 * question with many.
 */
function sweepForBracket(range: RangeFunction, r: Resolved): Bracket {
  const { minAngle, maxAngle, sweepSamples } = r;
  const step = (maxAngle - minAngle) / (sweepSamples - 1);

  let bestIndex = 0;
  let bestAngle = minAngle;
  let bestRange = Number.NEGATIVE_INFINITY;

  for (let i = 0; i < sweepSamples; i++) {
    // Last sample computed as maxAngle rather than minAngle + i·step, so a
    // bound the caller set exactly (π/2, or a hardware elevation limit) is
    // evaluated exactly rather than one rounding away from it.
    const theta = i === sweepSamples - 1 ? maxAngle : minAngle + i * step;
    const value = landedRange(range, theta);
    if (value > bestRange) {
      bestIndex = i;
      bestAngle = theta;
      bestRange = value;
    }
  }

  const interior = bestIndex > 0 && bestIndex < sweepSamples - 1;
  return {
    bestIndex,
    bestAngle,
    bestRange,
    lo: interior ? minAngle + (bestIndex - 1) * step : bestAngle,
    hi: interior ? minAngle + (bestIndex + 1) * step : bestAngle,
    interior,
    evaluations: sweepSamples,
  };
}

/**
 * Finds the elevation of maximum range, `argmax_θ R(θ)`.
 *
 * Two stages, for a reason worth stating: a coarse sweep over the angle bounds
 * to bracket the peak, then {@link brentMinimize} on `−R` to refine it. The
 * sweep is not laziness about bracketing — `R` is zero at both ends of
 * `[0, π/2]` and positive between, so *some* interior maximum always exists, but
 * an inadmissible region (aims whose shots do not land within the integration
 * span) can sit anywhere in the interval, and a two-point expansion strategy
 * walking into one has no way to tell "no impact" from "very short". A sweep
 * sees the whole interval at a fixed, reportable cost.
 *
 * **Maximizing by minimizing the negation is exactly equivalent here, and not
 * always.** Negation is exact in IEEE-754 — it flips one sign bit and perturbs
 * nothing — so the minimizer explores the identical sequence of points it would
 * on a natively-maximizing implementation, and {@link range} is a value `R` was
 * actually evaluated at rather than a negated round-trip. What negation does not
 * survive is an *inadmissible* value: `brentMinimize` reads non-finite as
 * `+∞` = "avoid", which is what "no impact" should mean for a maximization too,
 * so the two conventions coincide. They would not if a caller returned `0` for a
 * non-impact, which is why {@link NO_IMPACT} exists and is documented.
 *
 * Returns `status: "at-bound"` when the best sweep sample is an endpoint, rather
 * than refining a bracket that does not exist. That is a real answer — a
 * launcher whose elevation is capped below its unconstrained optimum should aim
 * at its cap — and it is deliberately distinguishable from `"converged"`,
 * because the reported θ is then a property of the *bounds* and not of the
 * physics, and `shiftFromDragFree` says nothing about drag.
 *
 * @param range Elevation in radians to range in metres. Should return
 *   {@link NO_IMPACT} or `NaN` for an aim that does not land.
 */
export function maximizeRange(
  range: RangeFunction,
  options: OptimalAngleOptions = {},
): OptimalAngle {
  const r = resolve(options);
  const bracket = sweepForBracket(range, r);

  if (bracket.bestRange === Number.NEGATIVE_INFINITY) {
    return {
      theta: Number.NaN,
      range: Number.NaN,
      bracket: [r.minAngle, r.maxAngle],
      sweepEvaluations: bracket.evaluations,
      refineEvaluations: 0,
      evaluations: bracket.evaluations,
      iterations: 0,
      status: "no-impact",
      converged: false,
      shiftFromDragFree: Number.NaN,
    };
  }

  if (!bracket.interior) {
    return {
      theta: bracket.bestAngle,
      range: bracket.bestRange,
      bracket: [bracket.bestAngle, bracket.bestAngle],
      sweepEvaluations: bracket.evaluations,
      refineEvaluations: 0,
      evaluations: bracket.evaluations,
      iterations: 0,
      status: "at-bound",
      converged: false,
      shiftFromDragFree: bracket.bestAngle - DRAG_FREE_PEAK_ANGLE,
    };
  }

  const refined = brentMinimize(
    (theta) => {
      const value = range(theta);
      return Number.isFinite(value) ? -value : Number.NaN;
    },
    bracket.lo,
    bracket.hi,
    {
      xTolAbsolute: r.angleTol,
      xTolRelative: r.angleTolRelative,
      maxIterations: r.maxIterations,
    },
  );

  // The sweep sample is kept if refinement somehow did no better. It cannot on a
  // unimodal peak -- the sample is inside the bracket refinement searches -- but
  // "cannot" resting on an assumption about the caller's `R` is not a reason to
  // return the worse of two numbers already in hand.
  const refinedRange = -refined.fx;
  const useRefined = refinedRange >= bracket.bestRange;
  const theta = useRefined ? refined.x : bracket.bestAngle;

  return {
    theta,
    range: useRefined ? refinedRange : bracket.bestRange,
    bracket: refined.bracket,
    sweepEvaluations: bracket.evaluations,
    refineEvaluations: refined.evaluations,
    evaluations: bracket.evaluations + refined.evaluations,
    iterations: refined.iterations,
    status: refined.status,
    converged: refined.converged,
    shiftFromDragFree: theta - DRAG_FREE_PEAK_ANGLE,
  };
}
