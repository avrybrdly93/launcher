import {
  type NewtonShootingOptions,
  type NewtonShootingResult,
  newtonShooting,
} from "./newton-shooting.js";
import type { Aim, ResidualFunction, ShootingResidual } from "./shooting-residual.js";

/**
 * Constraint handling for the aim, §7 Phase 5 (P5.16): box bounds on `θ` and
 * `v₀`, and the two classical ways of enforcing them — **projection** and
 * **penalty**.
 *
 * Bounds are not decoration on this problem. A ballista has a maximum draw, so
 * `v₀` has a hard upper limit; an elevation below the horizontal or past the
 * vertical is not a shot; and P5.15's minimum-energy solve is only meaningful
 * inside whatever the machine can actually do. Every one of those is a box
 * constraint on the two variables P5.06 solves for, and an unconstrained solver
 * handed a target outside the reachable set will happily report an aim that
 * requires 900 m/s from a machine that can manage 90.
 *
 * **The two strategies are not interchangeable, and the difference is
 * feasibility.**
 *
 * - {@link projectAim} clamps an aim onto the box. Threaded through the Newton
 *   solver as {@link NewtonShootingOptions.projection}, every iterate — and
 *   therefore the answer — is feasible *exactly*, at every stage of the
 *   iteration, by construction. The *iterates*, note, not every evaluation: the
 *   Jacobian's difference stencil still reaches one difference step past an
 *   active face — measured at `4.8e-4` m/s past a 70 m/s cap, and filed as
 *   P0.92 because it would matter at a bound that marks the model's domain.
 * - {@link withBoundsPenalty} adds a cost for leaving the box instead of
 *   forbidding it. Iterates may be infeasible, and so may the answer: feasibility
 *   holds only for weights inside a **measured four-order window**, and fails at
 *   both edges rather than improving monotonically with weight the way the
 *   textbook `1/√w` argument predicts. The sweep is in `constraints.test.ts` and
 *   the table is under {@link withBoundsPenalty}.
 *
 * Projection is the better default here and penalty exists because it composes
 * differently: it needs no cooperation from the solver at all (see
 * {@link withBoundsPenalty}), so it is what a caller reaches for when driving
 * the residual through something other than P5.06 — P5.27's multi-start, or the
 * Nelder–Mead of P5.02, which has no notion of a step to project.
 *
 * **What is deliberately not here.** This is a box, not a general nonlinear
 * constraint set, so the active set is the four faces and nothing else; there is
 * no working-set iteration, no Lagrange multipliers, and no KKT test beyond what
 * {@link aimActiveSet} reports. A genuine active-set QP belongs to a task that
 * has general constraints to justify it, and P5.16 does not.
 */

/**
 * Box bounds on the aim. Every field is optional and an omitted field means
 * that side is unbounded, so `{ speedMax: 90 }` is a complete and useful value.
 *
 * Stated as four scalars rather than as a pair of {@link Aim}s because "no
 * lower bound on θ but an upper bound on v₀" is the ordinary case, and a pair of
 * `Aim`s would force `-Infinity` sentinels into a type whose whole purpose
 * elsewhere is to be a real shot.
 */
export interface AimBounds {
  /** Lower bound on elevation, radians. Unbounded below when omitted. */
  readonly thetaMin?: number;
  /** Upper bound on elevation, radians. Unbounded above when omitted. */
  readonly thetaMax?: number;
  /** Lower bound on launch speed, m/s. Unbounded below when omitted. */
  readonly speedMin?: number;
  /** Upper bound on launch speed, m/s. Unbounded above when omitted. */
  readonly speedMax?: number;
}

/** Which face of the box a single variable is sitting on. */
export type BoundActivity = "free" | "lower" | "upper";

/** The active set at an aim: which bounds are being touched, and by what. */
export interface AimActiveSet {
  /** Whether `θ` sits on its lower bound, its upper bound, or neither. */
  readonly theta: BoundActivity;
  /** Whether `v₀` sits on its lower bound, its upper bound, or neither. */
  readonly speed: BoundActivity;
  /** How many of the two variables are on a bound: 0, 1 or 2. */
  readonly activeCount: number;
  /**
   * Signed distance to the nearest violated or touched bound, in each
   * variable's own units: negative inside the box, zero on a face, positive
   * outside it. `-Infinity` when that variable is unbounded on both sides.
   *
   * Reported because "active" is a tolerance question and a caller checking a
   * solve deserves the number the tolerance was applied to rather than just the
   * verdict it produced.
   */
  readonly thetaSlack: number;
  /** Companion to {@link thetaSlack} for `v₀`. */
  readonly speedSlack: number;
  /** Whether the aim is inside the box to within the same tolerance. */
  readonly feasible: boolean;
}

/** Tuning for {@link aimActiveSet}. */
export interface ActiveSetOptions {
  /**
   * Absolute distance from a bound, in that variable's own units, within which
   * the bound counts as active. Defaults to `1e-9`.
   *
   * **This is absolute rather than relative, and that is a decision about the
   * variables rather than a shortcut.** `θ` is order 1 radian and a perfectly
   * ordinary bound on it is `0` — the horizontal — against which a relative
   * tolerance is either zero or meaningless. `1e-9` rad is a nanoradian and
   * `1e-9` m/s is well below any speed a machine could be built to, so on both
   * axes the default is "as close as makes no physical difference" while still
   * sitting three orders above the rounding of a projection at these
   * magnitudes.
   */
  readonly tolerance?: number;
}

/** Tuning for {@link withBoundsPenalty}. */
export interface BoundsPenaltyOptions {
  /**
   * Penalty weight `w` on `θ` violations, in metres² per radian². Defaults to
   * {@link DEFAULT_PENALTY_WEIGHT}.
   *
   * The unit is the awkward part of the method and is worth stating plainly:
   * the residual is metres, so a penalty row added to it must be metres too,
   * which makes `√w` a conversion from radians of violation into metres of
   * apparent miss. There is no physically right value — the weight *is* the
   * exchange rate the caller is choosing between "miss the target" and "exceed
   * the elevation limit".
   */
  readonly thetaWeight?: number;
  /** Companion to {@link thetaWeight} for `v₀`, in metres² per (m/s)². */
  readonly speedWeight?: number;
}

/**
 * Default penalty weight for both variables: `1e6`, so `√w = 1000`.
 *
 * A violation of 1e-3 (a milliradian, or a millimetre per second) therefore
 * shows up as 1 metre of apparent miss, which sits far above a converged solve's
 * residual — P5.06 converges to `1e-6` m — so the penalty is visible to the
 * merit long before the miss is.
 *
 * **The value is picked from the measured window, not from that argument.** The
 * weight sweep in {@link withBoundsPenalty}'s comment puts the feasible plateau
 * at `1e3`–`1e7` on the speed-capped exhibit; `1e6` is inside it with three
 * orders of margin below and one above. The asymmetry is deliberate — the lower
 * edge fails gradually (a violation that grows) and the upper edge fails through
 * conditioning, which is harder to notice, so the default sits nearer the end
 * that degrades visibly. **This window was measured on one problem** and a
 * caller whose bounds or residual scale differ should measure their own rather
 * than trust this number.
 */
export const DEFAULT_PENALTY_WEIGHT = 1e6;

const DEFAULT_ACTIVE_TOLERANCE = 1e-9;

/**
 * Rejects bounds that cannot be satisfied or cannot be compared.
 *
 * Called eagerly by every entry point here, because an inverted box — `speedMin`
 * above `speedMax`, easy to produce from a swapped argument pair — has no
 * feasible point at all, and {@link projectAim} would silently resolve it by
 * clamping to whichever bound it applied second. A solve that then "respects the
 * bounds" while sitting on a box that does not exist is the failure this check
 * exists to make impossible.
 */
export function validateAimBounds(bounds: AimBounds): void {
  for (const [name, value] of [
    ["thetaMin", bounds.thetaMin],
    ["thetaMax", bounds.thetaMax],
    ["speedMin", bounds.speedMin],
    ["speedMax", bounds.speedMax],
  ] as const) {
    if (value !== undefined && Number.isNaN(value)) {
      throw new Error(`validateAimBounds: ${name} must not be NaN`);
    }
  }
  const { thetaMin, thetaMax, speedMin, speedMax } = bounds;
  if (thetaMin !== undefined && thetaMax !== undefined && thetaMin > thetaMax) {
    throw new Error(
      `validateAimBounds: thetaMin (${thetaMin}) exceeds thetaMax (${thetaMax}), so no aim is feasible`,
    );
  }
  if (speedMin !== undefined && speedMax !== undefined && speedMin > speedMax) {
    throw new Error(
      `validateAimBounds: speedMin (${speedMin}) exceeds speedMax (${speedMax}), so no aim is feasible`,
    );
  }
}

/** Clamp one scalar into `[lower, upper]`, either side possibly absent. */
function clamp(value: number, lower: number | undefined, upper: number | undefined): number {
  let result = value;
  if (lower !== undefined && result < lower) result = lower;
  if (upper !== undefined && result > upper) result = upper;
  return result;
}

/**
 * The Euclidean projection of an aim onto the box — which, for a box, is a
 * per-coordinate clamp.
 *
 * That is worth one sentence of justification rather than being assumed: the
 * projection onto a Cartesian product of intervals separates, because the
 * squared distance `Σ(xᵢ − pᵢ)²` is a sum of terms each depending on one
 * coordinate and each constrained independently. It is *not* true for a general
 * convex set, and a later task that bounds, say, the muzzle energy `½mv₀²`
 * jointly with the elevation cannot reuse this function.
 *
 * The projection is idempotent and non-expansive, which is what makes the
 * projected-arc line search of {@link newtonShooting} well behaved: shrinking
 * `α` shrinks the projected displacement monotonically to zero, so backtracking
 * still terminates.
 */
export function projectAim(aim: Aim, bounds: AimBounds): Aim {
  validateAimBounds(bounds);
  return {
    theta: clamp(aim.theta, bounds.thetaMin, bounds.thetaMax),
    speed: clamp(aim.speed, bounds.speedMin, bounds.speedMax),
  };
}

/** Signed distance to the nearest bound: negative inside, positive outside. */
function slack(value: number, lower: number | undefined, upper: number | undefined): number {
  const belowLower = lower === undefined ? Number.NEGATIVE_INFINITY : lower - value;
  const aboveUpper = upper === undefined ? Number.NEGATIVE_INFINITY : value - upper;
  return Math.max(belowLower, aboveUpper);
}

function activity(
  value: number,
  lower: number | undefined,
  upper: number | undefined,
  tolerance: number,
): BoundActivity {
  // Order matters only for a degenerate box (`lower === upper`), where both
  // faces are active and the aim is pinned; reporting "lower" there is
  // arbitrary but stable, and `activeCount` still counts the variable once
  // because it is one variable with one value.
  if (lower !== undefined && value <= lower + tolerance) return "lower";
  if (upper !== undefined && value >= upper - tolerance) return "upper";
  return "free";
}

/**
 * The active set at an aim: which bounds it is sitting on, how far it is from
 * them, and whether it is inside the box at all.
 *
 * This is the reporting half of P5.16's validation criterion, and it is a
 * separate function from the solve on purpose — a caller checking that a
 * constrained answer respects its bounds should be able to do so from the aim
 * and the bounds alone, without trusting anything the solver said about itself.
 * `constraints.test.ts` uses it in exactly that adversarial way.
 *
 * **What an active bound means for the answer.** A converged solve with an empty
 * active set is an ordinary interior solution and the bounds did nothing. A
 * converged solve *with* an active bound is a solution of a different problem
 * than the unconstrained one: the constraint is carrying part of the load, and
 * the residual that remains is the miss the box would not let the solver remove.
 * {@link ConstrainedShootingResult.status} distinguishes the two, and the
 * distinction is the reason a bare "converged: false" would be an unhelpful
 * answer for a bounded problem.
 */
export function aimActiveSet(
  aim: Aim,
  bounds: AimBounds,
  options: ActiveSetOptions = {},
): AimActiveSet {
  validateAimBounds(bounds);
  const tolerance = options.tolerance ?? DEFAULT_ACTIVE_TOLERANCE;
  if (!(tolerance >= 0)) {
    throw new Error(`aimActiveSet: tolerance must be non-negative; got ${tolerance}`);
  }

  const theta = activity(aim.theta, bounds.thetaMin, bounds.thetaMax, tolerance);
  const speed = activity(aim.speed, bounds.speedMin, bounds.speedMax, tolerance);
  const thetaSlack = slack(aim.theta, bounds.thetaMin, bounds.thetaMax);
  const speedSlack = slack(aim.speed, bounds.speedMin, bounds.speedMax);

  return {
    theta,
    speed,
    activeCount: (theta === "free" ? 0 : 1) + (speed === "free" ? 0 : 1),
    thetaSlack,
    speedSlack,
    feasible: thetaSlack <= tolerance && speedSlack <= tolerance,
  };
}

/**
 * The exterior-penalty rows for an aim: `√w · max(0, violation)` for each of the
 * four faces, in the order `θ` lower, `θ` upper, `v₀` lower, `v₀` upper.
 *
 * Always four numbers, most of them zero most of the time, rather than a
 * variable-length list of the violated faces — because these become rows of a
 * residual vector that {@link shootingJacobian} finite-differences, and a
 * residual whose *length* changes as the aim moves is not a function that can be
 * differenced at all. That is the one non-obvious constraint the design has to
 * respect and it is why the zeros are kept.
 *
 * **The hinge is squared by the merit, and that is what makes it usable.** Each
 * row enters `‖F‖²` as `w·max(0, g)²`, whose derivative `2w·max(0, g)·g′` is
 * continuous across the face — the kink in the hinge is at a point where the
 * term is zero, so the penalty is C¹ overall and a Gauss–Newton method sees a
 * differentiable problem. A linear penalty `w·|g|` would be exact for finite `w`
 * but non-smooth exactly on the faces, which is where the answer sits.
 */
export function boundsPenaltyRows(
  aim: Aim,
  bounds: AimBounds,
  options: BoundsPenaltyOptions = {},
): number[] {
  validateAimBounds(bounds);
  const thetaWeight = options.thetaWeight ?? DEFAULT_PENALTY_WEIGHT;
  const speedWeight = options.speedWeight ?? DEFAULT_PENALTY_WEIGHT;
  for (const [name, weight] of [
    ["thetaWeight", thetaWeight],
    ["speedWeight", speedWeight],
  ] as const) {
    if (!(weight >= 0) || !Number.isFinite(weight)) {
      throw new Error(`boundsPenaltyRows: ${name} must be finite and non-negative; got ${weight}`);
    }
  }

  const rootTheta = Math.sqrt(thetaWeight);
  const rootSpeed = Math.sqrt(speedWeight);
  const hinge = (violation: number): number => (violation > 0 ? violation : 0);

  return [
    bounds.thetaMin === undefined ? 0 : rootTheta * hinge(bounds.thetaMin - aim.theta),
    bounds.thetaMax === undefined ? 0 : rootTheta * hinge(aim.theta - bounds.thetaMax),
    bounds.speedMin === undefined ? 0 : rootSpeed * hinge(bounds.speedMin - aim.speed),
    bounds.speedMax === undefined ? 0 : rootSpeed * hinge(aim.speed - bounds.speedMax),
  ];
}

/**
 * Wraps a residual function so that leaving the box costs something, by
 * appending {@link boundsPenaltyRows} to the residual vector.
 *
 * **This needs no cooperation from the solver, which is the whole reason the
 * strategy is worth having.** The Gauss–Newton stack above P5.04 is generic in
 * the number of residual rows — `shootingJacobian` reads its row count off the
 * residual it is handed, `minimumNormStep` takes any `m × 2` matrix, and
 * `residualNorm` sums whatever it is given — so a residual that is four
 * components longer flows through P5.05 and P5.06 unchanged, and the penalty
 * appears in the merit, the Jacobian and the line search with no new code on
 * any of those paths. The penalized problem is just a different least-squares
 * problem in the same shape.
 *
 * **What it costs, as measured rather than as predicted.** The textbook story
 * for an exterior penalty is a violation of order `1/√w` that shrinks smoothly
 * as the weight grows. **That is not what this problem does, and the draft of
 * this comment that asserted it was wrong.** Sweeping the weight across ten
 * orders on a speed-capped solve (`constraints.test.ts`) gives a
 * **non-monotonic** picture with a usable window in the middle:
 *
 * | weight `w`      | violation of a 70 m/s cap |
 * | --------------- | ------------------------- |
 * | `1e0` – `1e2`   | `9.4` → `2.2` m/s — grossly infeasible, and `1e2` does not converge at all |
 * | `1e3` – `1e7`   | `≈ −5e-11` m/s — *inside* the bound, feasible to the active-set tolerance |
 * | `3e7` – `1e9`   | `1.9e-5` → `1.2e-6` m/s — infeasible again |
 *
 * The middle plateau is not the balance the `1/√w` argument describes. The hinge
 * is exactly zero inside the box, so once an iterate is feasible the penalized
 * problem is *locally identical* to the unconstrained one and pushes straight
 * back out; the penalty rows then dominate the merit and pull it back. The
 * iteration chatters onto the face and stops there — behaving like an inexact
 * projection rather than like a smooth trade. At the top end the `√w` rows
 * degrade the Jacobian's conditioning and feasibility gets *worse* with more
 * weight, which the `1/√w` story cannot express at all.
 *
 * The practical reading: the weight has a **four-order usable window** on this
 * problem and both edges are failure, so a caller who cannot measure their own
 * problem's window should use projection. **Projection has no weight to choose,
 * no window to fall out of, and is feasible by construction**; this function is
 * for the solvers that cannot take a projection.
 *
 * A failed evaluation is passed through untouched: `ok: false` carries a `null`
 * residual, there is nothing to append to, and a penalty on an aim whose
 * trajectory does not exist would be inventing a finite merit for a point that
 * has none.
 */
export function withBoundsPenalty(
  residual: ResidualFunction,
  bounds: AimBounds,
  options: BoundsPenaltyOptions = {},
): ResidualFunction {
  validateAimBounds(bounds);
  return (aim: Aim): ShootingResidual => {
    const evaluation = residual(aim);
    if (!evaluation.ok || evaluation.residual === null) return evaluation;
    return {
      ...evaluation,
      residual: [...evaluation.residual, ...boundsPenaltyRows(aim, bounds, options)],
    };
  };
}

/** Which enforcement strategy {@link constrainedShooting} should use. */
export type ConstraintStrategy = "projection" | "penalty";

/** Tuning for {@link constrainedShooting}. */
export interface ConstrainedShootingOptions extends NewtonShootingOptions {
  /**
   * Enforcement strategy. Defaults to `"projection"` — the one that produces an
   * exactly feasible answer; see the module comment for when `"penalty"` is
   * nonetheless the right call.
   */
  readonly strategy?: ConstraintStrategy;
  /** Penalty weights. Ignored under the `"projection"` strategy. */
  readonly penalty?: BoundsPenaltyOptions;
  /** Tolerance for the reported active set. */
  readonly activeSet?: ActiveSetOptions;
}

/** How a constrained solve ended, over and above what Newton reported. */
export type ConstrainedShootingStatus =
  /** `‖F‖` met the tolerance with no bound active: an ordinary interior solution. */
  | "converged-interior"
  /**
   * `‖F‖` met the tolerance with at least one bound active. The answer is a hit
   * *and* sits on a face — feasible, converged, and worth distinguishing because
   * the constraint may be the only thing holding it there.
   */
  | "converged-on-bound"
  /**
   * The iteration stopped moving with a bound active and a residual left over:
   * the box is what prevents the miss from being removed. **This is the
   * characteristic constrained outcome and not a failure** — the honest answer
   * to "hit this target with at most 90 m/s" when 90 m/s cannot reach it is the
   * best feasible aim and the miss that remains.
   */
  | "blocked-by-bound"
  /** Newton stopped for a reason that has nothing to do with the bounds. */
  | "unconstrained-failure";

/** What {@link constrainedShooting} returns. */
export interface ConstrainedShootingResult {
  /** The underlying Newton result, verbatim. */
  readonly newton: NewtonShootingResult;
  /** The final aim. Feasible by construction under `"projection"`. */
  readonly aim: Aim;
  /** The active set at {@link aim}, computed from the aim and the bounds alone. */
  readonly activeSet: AimActiveSet;
  /** The constrained reading of how the solve ended. */
  readonly status: ConstrainedShootingStatus;
  /** Whether {@link aim} satisfies the bounds to the active-set tolerance. */
  readonly feasible: boolean;
  /** Which strategy was used. */
  readonly strategy: ConstraintStrategy;
  /**
   * `‖F‖` at {@link aim}, counting **only the physical miss** — the penalty rows
   * are excluded under the `"penalty"` strategy.
   *
   * Reported separately because the merit Newton minimized under that strategy
   * is a different quantity from the miss, and quoting the penalized merit as
   * "the miss" would overstate it by exactly the constraint violation the
   * strategy is failing to remove.
   */
  readonly miss: number;
}

/**
 * Solve the shooting problem subject to box bounds on the aim, by whichever of
 * P5.16's two strategies the caller asks for, and report the active set.
 *
 * This is the entry point P5.16's validation criterion is stated against:
 * *constrained solutions respect bounds; active-set reported*. Both halves are
 * checked from the outside in `constraints.test.ts` — feasibility via
 * {@link aimActiveSet} recomputed from the returned aim, never from anything the
 * solver claims about itself.
 *
 * **The status is the useful output on a bounded problem, more than the boolean
 * is.** An unconstrained solver has two outcomes, hit and miss. A bounded one
 * has four, and collapsing them loses the distinction that matters: a solve that
 * `stalled` with a bound active has not failed — it has proved that the target
 * is out of reach for a machine with those limits, and returned the best aim
 * available under them. {@link ConstrainedShootingStatus} keeps that separate
 * from a Newton failure that would have happened bounds or no bounds.
 */
export function constrainedShooting(
  residual: ResidualFunction,
  initialAim: Aim,
  bounds: AimBounds,
  options: ConstrainedShootingOptions = {},
): ConstrainedShootingResult {
  validateAimBounds(bounds);
  const strategy = options.strategy ?? "projection";

  // `ConstrainedShootingOptions` extends `NewtonShootingOptions`, so `options`
  // is passed through whole rather than re-picked field by field. The three
  // fields Newton does not know about are inert to it, and a re-pick would be a
  // second list to keep in step with the first every time either grows.
  const newton =
    strategy === "projection"
      ? newtonShooting(residual, initialAim, {
          ...options,
          projection: (aim: Aim) => projectAim(aim, bounds),
        })
      : newtonShooting(withBoundsPenalty(residual, bounds, options.penalty), initialAim, options);

  const aim = newton.aim;
  const activeSet = aimActiveSet(aim, bounds, options.activeSet);

  // Under the penalty strategy `newton.merit` includes the penalty rows, so the
  // physical miss has to be re-formed from the position components. The residual
  // vector is the miss followed by the four penalty rows, in that order, so the
  // miss is everything before them (see `boundsPenaltyRows`).
  const components = newton.residual.residual;
  const missComponents =
    strategy === "penalty" && components !== null
      ? components.slice(0, Math.max(components.length - 4, 0))
      : components;
  let miss = Number.POSITIVE_INFINITY;
  if (newton.residual.ok && missComponents !== null) {
    let sum = 0;
    for (const component of missComponents) sum += component * component;
    miss = Math.sqrt(sum);
  }

  const residualTolerance = options.residualTolerance ?? 1e-6;
  const hit = miss <= residualTolerance;
  const anyActive = activeSet.activeCount > 0;
  let status: ConstrainedShootingStatus;
  if (hit) {
    status = anyActive ? "converged-on-bound" : "converged-interior";
  } else if (anyActive && (newton.status === "stalled" || newton.status === "line-search-failed")) {
    status = "blocked-by-bound";
  } else {
    status = "unconstrained-failure";
  }

  return {
    newton,
    aim,
    activeSet,
    status,
    feasible: activeSet.feasible,
    strategy,
    miss,
  };
}
