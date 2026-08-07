import { brentRoot } from "@ballista/solverkit";

/**
 * The scalar inverse problem of §7 Phase 5 (P5.03): given a launch speed, find
 * the elevation angle whose range equals a requested `R*`.
 *
 * This module is deliberately *not* a root finder. Bracketed scalar root
 * finding already exists in `@ballista/solverkit` as `brentRoot`, written for
 * P2.33's event localization and documented there as the function Phase 5's
 * range matching is meant to reuse rather than reimplement. What is new here is
 * the *problem*: choosing the residual, establishing brackets that isolate each
 * arc, and reporting reachability.
 *
 * **Range is not monotone in θ, and that is the whole difficulty.** It rises
 * from zero at θ = 0 to a maximum and falls back to zero at θ = π/2, so a
 * reachable `R*` strictly below the maximum has *two* solutions — the low
 * (flat, fast) arc and the high (lofted) arc — and a bracketing method needs to
 * be told which side of the peak to look on. Every function here takes the
 * peak angle as data for that reason; see {@link RangeRootOptions.peakAngle}.
 */

/**
 * A range function: elevation angle in radians to horizontal distance in
 * metres, at whatever launch speed and conditions the caller has closed over.
 *
 * Taking the range model as a parameter rather than hard-coding
 * {@link dragFreeRange} is what lets P5.06's Newton shooting reuse this module
 * with an *integrated* range — the drag-free closed form is the case P5.03
 * validates against, not the only case the code is for.
 */
export type RangeFunction = (theta: number) => number;

/**
 * The elevation angle, in radians, at which a drag-free ground launch achieves
 * its maximum range: π/4, exactly, independent of speed and gravity.
 *
 * This is the default {@link RangeRootOptions.peakAngle} and it is correct for
 * exactly one family of problems — drag-free, launched from and landing at the
 * same height. A raised launch peaks *below* π/4 and a launch with drag peaks
 * lower still, so a caller in either situation must supply its own value.
 * Computing the peak for the general case is P5.09's reachability envelope
 * (a θ sweep) and P5.13's 1D minimizer, not this task's work.
 */
export const DRAG_FREE_PEAK_ANGLE = Math.PI / 4;

/** Standard gravity, matching `@ballista/engine`'s `G_STD`. */
const G_STD = 9.80665;

/**
 * Drag-free range of a ground launch: `v₀² sin(2θ) / g`.
 *
 * Ground launch only — launch and impact at the same height. The raised-launch
 * form carries a `√(v_y0² + 2 g y₀)` term whose peak angle is no longer π/4,
 * which would make the default in {@link RangeRootOptions.peakAngle} silently
 * wrong; raised launches are the shooting solvers' business (P5.04 onward),
 * where the range comes from an integrated trajectory anyway.
 */
export function dragFreeRange(v0: number, theta: number, g: number = G_STD): number {
  return (v0 * v0 * Math.sin(2 * theta)) / g;
}

/** Options shared by {@link solveRangeRoot} and {@link solveRangeRoots}. */
export interface RangeRootOptions {
  /**
   * Angle of maximum range, in radians. Separates the increasing (low-arc)
   * branch from the decreasing (high-arc) branch, so that each is monotone and
   * therefore has at most one root.
   *
   * Defaults to {@link DRAG_FREE_PEAK_ANGLE}, which is right *only* for a
   * drag-free ground launch.
   */
  readonly peakAngle?: number;
  /** Lowest elevation angle considered, in radians. Default `0`. */
  readonly minAngle?: number;
  /** Highest elevation angle considered, in radians. Default `π/2`. */
  readonly maxAngle?: number;
  /**
   * Absolute convergence tolerance on θ, in radians. Default `1e-12`.
   *
   * Passed to `brentRoot` as a bracket-width tolerance of
   * `2ε|θ| + angleTol/2`, the standard `zbrent` form: the relative term keeps
   * the request meaningful when it is finer than the floating-point spacing at
   * θ, and the absolute term is what the caller actually asked for. The
   * default is two orders tighter than P5.03's 1e-10 criterion so that the
   * criterion measures the *method*, not the stopping rule.
   */
  readonly angleTol?: number;
  /** Hard iteration backstop handed to `brentRoot`. Default `100`. */
  readonly maxIterations?: number;
}

/** A converged root of `range(θ) = R*`. */
export interface RangeRoot {
  /** Elevation angle, in radians. */
  readonly theta: number;
  /** Residual `range(θ) − R*` there, in metres — reported, never assumed zero. */
  readonly residual: number;
  /** `brentRoot` iterations spent. */
  readonly iterations: number;
}

/**
 * Result of {@link solveRangeRoots}.
 *
 * `low` and `high` are independently nullable rather than an all-or-nothing
 * pair, because an angle bound can remove one arc without removing the other:
 * a launcher restricted to `minAngle = 20°` cannot fly the flat arc to a target
 * closer than its 20° range, but the lofted arc to that same target is still
 * available. Reporting one root and `null` says that; a thrown error or a
 * `reachable: false` would not.
 */
export interface RangeRootsResult {
  /**
   * Whether `targetRange` is within reach at all — that is, no greater than
   * {@link maxRange}. False implies both arcs are `null`, but not the converse.
   */
  readonly reachable: boolean;
  /** The flat, fast arc: the root below {@link peakAngle}, or `null` if the bounds exclude it. */
  readonly low: RangeRoot | null;
  /** The lofted arc: the root above {@link peakAngle}, or `null` if the bounds exclude it. */
  readonly high: RangeRoot | null;
  /** Range at {@link peakAngle}, in metres — the best this launcher can do. */
  readonly maxRange: number;
  /** The peak angle used, in radians (the resolved {@link RangeRootOptions.peakAngle}). */
  readonly peakAngle: number;
  /** How far the request exceeded {@link maxRange}, in metres; `0` when reachable. */
  readonly shortfall: number;
}

function resolve(options: RangeRootOptions): Required<RangeRootOptions> {
  return {
    peakAngle: options.peakAngle ?? DRAG_FREE_PEAK_ANGLE,
    minAngle: options.minAngle ?? 0,
    maxAngle: options.maxAngle ?? Math.PI / 2,
    angleTol: options.angleTol ?? 1e-12,
    maxIterations: options.maxIterations ?? 100,
  };
}

/**
 * Solves `range(θ) = targetRange` on a bracket the caller guarantees is
 * monotone, by handing the residual to `brentRoot`.
 *
 * Throws if `[a, b]` does not bracket a sign change — that is a statement about
 * the problem (the requested range is not attained on this arc), not a
 * numerical failure, and silently returning an endpoint would let a caller mistake
 * an unreachable target for a grazing solution. {@link solveRangeRoots} checks
 * reachability first and so never provokes it.
 */
export function solveRangeRoot(
  rangeFn: RangeFunction,
  targetRange: number,
  a: number,
  b: number,
  options: RangeRootOptions = {},
): RangeRoot {
  const { angleTol, maxIterations } = resolve(options);
  const residual = (theta: number): number => rangeFn(theta) - targetRange;
  const result = brentRoot(
    residual,
    a,
    b,
    residual(a),
    residual(b),
    (theta) => 2 * Number.EPSILON * Math.abs(theta) + angleTol / 2,
    maxIterations,
  );
  if (!result.converged) {
    throw new Error(
      `solveRangeRoot: no convergence to ${angleTol} rad in ${maxIterations} iterations ` +
        `(best θ = ${result.x}, residual = ${result.fx} m)`,
    );
  }
  return { theta: result.x, residual: result.fx, iterations: result.iterations };
}

/**
 * Finds **both** elevation angles that put the range at `targetRange`, or
 * reports that no angle does.
 *
 * The two arcs are found by bracketing on either side of the peak rather than
 * by solving once and reflecting about it. Reflection would be shorter and is
 * exactly right for the drag-free ground launch this task validates against —
 * where the roots are `½ asin(g R* / v₀²)` and its complement to π/2 — but it
 * is a property of `sin(2θ)`'s symmetry, not of the problem. A range function with
 * drag is *not* symmetric about its peak, so a reflected "root" would come back
 * with a residual that is merely small rather than converged, and the
 * discrepancy would grow with drag. Bracketing each branch separately costs one
 * extra Brent solve and means the same call is correct for P5.06's integrated
 * range.
 */
export function solveRangeRoots(
  rangeFn: RangeFunction,
  targetRange: number,
  options: RangeRootOptions = {},
): RangeRootsResult {
  const opts = resolve(options);
  const { peakAngle, minAngle, maxAngle } = opts;
  if (!(minAngle < peakAngle && peakAngle < maxAngle)) {
    throw new Error(
      `solveRangeRoots: peakAngle ${peakAngle} must lie strictly inside [${minAngle}, ${maxAngle}]`,
    );
  }

  const maxRange = rangeFn(peakAngle);
  if (targetRange > maxRange) {
    return {
      reachable: false,
      low: null,
      high: null,
      maxRange,
      peakAngle,
      shortfall: targetRange - maxRange,
    };
  }

  // Each branch is monotone, so it holds a root exactly when its two endpoint
  // ranges straddle the target. `maxRange >= targetRange` is already known, so
  // only the outer endpoint of each branch is still in question -- which is
  // what an angle bound moves.
  const low =
    rangeFn(minAngle) <= targetRange
      ? solveRangeRoot(rangeFn, targetRange, minAngle, peakAngle, opts)
      : null;
  const high =
    rangeFn(maxAngle) <= targetRange
      ? solveRangeRoot(rangeFn, targetRange, peakAngle, maxAngle, opts)
      : null;

  return { reachable: true, low, high, maxRange, peakAngle, shortfall: 0 };
}
