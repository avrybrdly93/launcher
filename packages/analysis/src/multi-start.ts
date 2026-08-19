import { rangeSlopeAt } from "./basin-of-attraction.js";
import { type AimBounds, constrainedShooting } from "./constraints.js";
import type { NewtonShootingOptions } from "./newton-shooting.js";
import { PLANAR_LAYOUT, type TrajectoryLayout, downrangeAxisOf } from "./observables.js";
import type { Aim, ResidualFunction } from "./shooting-residual.js";

/**
 * Multi-start with deduplication for §7 Phase 5 (P5.27): scatter starting
 * guesses across the whole elevation range, run a *local* solve from each, and
 * collapse the answers into the distinct solutions they actually represent.
 *
 * The criterion is **"finds both arcs without user hint"**, and the word doing
 * the work is *hint*. P5.08's {@link solveArcs} also finds both arcs, but it
 * finds them by knowing where to look: it locates the maximum-range elevation
 * with a 24-sample sweep and a refinement, then puts one bracket either side of
 * it, so each Brent solve is handed an interval guaranteed to contain exactly
 * one root. That peak is the hint. This module has no peak, no bracket and no
 * ordering assumption — only starting points and a local method that walks
 * downhill from each — and the two arcs have to *fall out* of where the starts
 * happen to land.
 *
 * **Why the speed is held fixed, which is the one design decision here that
 * could have gone another way.** Deduplication presupposes that the solutions
 * are isolated points, and on the unconstrained aim problem they are not. P5.05
 * measured the shooting Jacobian's vertical row as zero for every aim — a
 * ground-impact event pins the impact height — so `F` is one scalar equation in
 * two unknowns and its solution set is a *curve* in `(θ, v₀)`. P5.06's
 * minimum-norm step lands on the point of that curve nearest the start, so
 * different starts converge to genuinely different, genuinely valid answers.
 * Measured on a 140 m target with 21 starts spread over `θ ∈ [0.15, 1.35]` and
 * `v₀ ∈ {40, 55, 70}`: **21 starts, 21 distinct converged aims**, every one of
 * them with a downrange miss below `3e-10` m. Deduplicating those by proximity
 * would report twenty-one solutions, and it would be right to — they are
 * twenty-one solutions. There are no two arcs to find, because "low" and "high"
 * are not defined on a curve.
 *
 * They are defined the moment the speed is fixed, which is also how P5.08
 * states the problem: *fix the speed, and the curve meets that constraint
 * twice.* So the starts here vary elevation only, and the local solve runs
 * under P5.16's projection strategy with a degenerate speed box `[v₀, v₀]`.
 * The same 140 m target at a fixed 55 m/s, from 16 starts spread over
 * `θ ∈ [0.05, 1.5]`, gives **two** distinct elevations — 0.30304240 and
 * 1.18564859 rad, 7 starts and 8 starts respectively — each reproduced to
 * within `6.1e-9` rad from every start in its basin. That is a deduplication
 * problem, and this module solves it.
 *
 * **The sixteenth start finds neither, and that is the right answer.** It lands
 * at `θ = 0.7346`, 3.3 mrad from the maximum-range elevation, where `∂R/∂θ` is
 * passing through zero; the projected step is near zero there too, so the
 * iteration stops on its step tolerance after one iteration with 66 m of miss
 * left. It is P5.20's basin boundary, sampled. Rejecting it is correct — the
 * peak belongs to neither branch — and `multi-start.test.ts` asserts that
 * *exactly* that one start is lost, so a change that silently accepts it or
 * loses a second one fails.
 *
 * **The labels come from a local derivative, not from the pair.** With exactly
 * two solutions in hand it is tempting to call the shallower one "low", but
 * that reasoning fails the moment a bound clips one arc away or a near-envelope
 * merge leaves one. The branch a solution sits on is instead read off the sign
 * of `∂R/∂θ` there, reusing P5.20's {@link rangeSlopeAt}: downrange is still
 * rising in elevation on the low branch and already falling on the high one,
 * because the boundary between them *is* the point where that derivative
 * changes sign. It is a local measurement at the solution and needs no
 * knowledge of where the peak is, so it does not smuggle the hint back in.
 *
 * **The merge tolerance is the one number that can silently produce a wrong
 * answer**, and it is reported on rather than trusted. Two arcs are far apart
 * in the middle of the reachable band and arbitrarily close near the envelope —
 * P5.26 measured a pair under 0.04 rad apart at a 1 cm shortfall — so a
 * tolerance chosen for the easy case would fuse a real pair into one solution
 * near the hard one. {@link MultiStartResult.minimumSeparation} is the smallest
 * gap between adjacent distinct solutions and
 * {@link MultiStartSolution.spread} is the widest disagreement *within* one
 * cluster; a caller can check the first is orders above the tolerance and the
 * second orders below it, and stop believing the count when they are not.
 */

/** Which branch a {@link MultiStartSolution} sits on. */
export type MultiStartBranch = "low" | "high" | "indeterminate";

/** One distinct solution, and the evidence that it is one. */
export interface MultiStartSolution {
  /** The representative aim: the cluster member with the smallest miss. */
  readonly aim: Aim;
  /**
   * Which branch, from the sign of `∂R/∂θ` at {@link aim}.
   *
   * `"indeterminate"` when the derivative could not be measured — either probe
   * aim failed to impact — or came back exactly zero, which is a solution
   * sitting on the peak itself and belonging to neither branch. Guessing a
   * label there would be worse than declining to.
   */
  readonly branch: MultiStartBranch;
  /** `∂R/∂θ` at {@link aim}, m/rad; `null` when it could not be measured. */
  readonly rangeSlope: number | null;
  /** Signed downrange miss at {@link aim}, metres: negative short, positive long. */
  readonly downrangeMiss: number;
  /**
   * How many starts converged here — the size of this solution's basin within
   * the sampled set. A solution reached from one start out of forty is a real
   * solution with a thin basin, which is exactly what P5.20's boundary
   * structure predicts and is worth seeing rather than averaging away.
   */
  readonly starts: number;
  /**
   * Widest elevation disagreement between members of this cluster, radians.
   *
   * The number that says whether the cluster is one solution found repeatedly
   * or two solutions fused by too loose a
   * {@link MultiStartOptions.mergeTolerance}. Zero for a single-member cluster.
   */
  readonly spread: number;
  /** Elevations of every start that converged here, ascending. */
  readonly members: readonly number[];
}

/** Tuning for {@link multiStart}. */
export interface MultiStartOptions {
  /** Lowest starting elevation considered, radians. Default `0.05`. */
  readonly minAngle?: number;
  /** Highest starting elevation considered, radians. Default `π/2 − 0.05`. */
  readonly maxAngle?: number;
  /**
   * How many starting elevations to try. Default `16`.
   *
   * Sixteen is not tuned to the two-arc answer — it is the smallest count that
   * leaves both basins several starts wide on the scenario library's problems,
   * so that a basin thinning out shows up as a falling
   * {@link MultiStartSolution.starts} rather than as a solution vanishing.
   */
  readonly startCount?: number;
  /**
   * Explicit starting elevations, radians, overriding {@link startCount} and
   * the angle bounds.
   *
   * Present so a test can pin the exact starts it reasons about, and so a
   * caller resuming a previous sweep can re-run only the starts it cares
   * about. Supplying starts that bracket a known answer would of course put
   * the hint back; that is the caller's business, not this module's.
   */
  readonly starts?: readonly number[];
  /**
   * Downrange miss, metres, below which a start counts as having found a
   * solution. Default `1e-3`.
   *
   * Gated on the downrange component alone, and on this looser threshold
   * rather than on the solver's own `converged` flag, for P5.20's reason: the
   * vertical residual of a ground-impact shot against a raised target cannot
   * be nulled by any aim, so a solver that did everything right still reports
   * a non-zero `‖F‖`. Judging by `converged` would reject every solution on
   * exactly the problems this is most useful on.
   */
  readonly downrangeTolerance?: number;
  /**
   * Elevations within this distance of each other, radians, are the same
   * solution. Default `1e-6`.
   *
   * Two orders below the tightest arc separation P5.26 constructed (0.04 rad at
   * a 1 cm shortfall) and four above the `1e-12` to which a converged elevation
   * is reproducible from different starts, so the default has room on both
   * sides. It is still a guess about the problem rather than a property of it —
   * see {@link MultiStartResult.minimumSeparation}.
   */
  readonly mergeTolerance?: number;
  /**
   * Central-difference step in `θ` for the branch derivative, radians.
   * Default `1e-4`, matching `sweepBasins`'s own slope step and sized the same
   * way: against the integrator's accuracy, not against `√ε`.
   */
  readonly slopeStep?: number;
  /** Passed through to every local solve. */
  readonly newton?: NewtonShootingOptions;
  /** Channel layout of the model's state. Defaults to {@link PLANAR_LAYOUT}. */
  readonly layout?: TrajectoryLayout;
}

/** What one start did, before deduplication. */
export interface MultiStartAttempt {
  /** The starting elevation, radians. */
  readonly start: number;
  /** The converged aim, or `null` when the solve could not be evaluated. */
  readonly aim: Aim | null;
  /** Signed downrange miss, metres; `null` when the solve could not be evaluated. */
  readonly downrangeMiss: number | null;
  /** Whether {@link downrangeMiss} met {@link MultiStartOptions.downrangeTolerance}. */
  readonly accepted: boolean;
  /** Local-solver iterations spent. */
  readonly iterations: number;
}

/** What {@link multiStart} returns. */
export interface MultiStartResult {
  /** The launch speed every start and every solution shares, m/s. */
  readonly speed: number;
  /** The distinct solutions, ascending in elevation. */
  readonly solutions: readonly MultiStartSolution[];
  /** Every start's outcome, in the order they were tried. */
  readonly attempts: readonly MultiStartAttempt[];
  /** How many starts produced an accepted solution. */
  readonly accepted: number;
  /**
   * Smallest elevation gap between adjacent distinct solutions, radians;
   * `Infinity` when fewer than two were found.
   *
   * The check on {@link MultiStartOptions.mergeTolerance}: a value close to the
   * tolerance means the deduplication was one rounding away from returning a
   * different count, and the count should not be believed without tightening
   * it. See the module docstring.
   */
  readonly minimumSeparation: number;
  /** Trajectory integrations spent: local solves, acceptance checks and slopes. */
  readonly evaluations: number;
}

/**
 * Deterministic low-discrepancy points in `[0, 1)`, from the additive
 * recurrence `xₙ = frac(n φ⁻¹)`.
 *
 * **Not because it beats a uniform grid at a fixed count — measured, it does
 * not.** At `count = 16` the largest gap this sequence leaves is `0.0902`,
 * against a grid's uniform `1/16 = 0.0625`. Anyone reaching for a
 * low-discrepancy sequence on a max-gap argument at one count has the wrong
 * argument, and `multi-start.test.ts` pins the measurement so the claim cannot
 * quietly reappear.
 *
 * The two properties it is actually chosen for are both about *changing* the
 * count. First, by the three-distance theorem the gaps take **at most three
 * distinct lengths at every `n`** — measured here as exactly three: `0.0344`,
 * `0.0557`, `0.0902` — so the point set never develops a void as it grows;
 * each new point splits one of the largest gaps. Second, the sequence
 * **extends rather than resamples**: the first `n` of `n + k` points are the
 * first `n`, so raising {@link MultiStartOptions.startCount} keeps every solve
 * already paid for, where refining a grid moves every sample and throws all of
 * them away. It is also seedless and fully reproducible, which a pseudo-random
 * scatter would not be, and P5.25's golden results depend on solver inputs
 * being byte-identical between runs.
 *
 * Exported so that a test can assert what the starts *were*, rather than
 * asserting a solution count against starts it cannot see.
 */
export function goldenRatioSamples(count: number): number[] {
  if (!Number.isInteger(count) || count < 1) {
    throw new Error(`goldenRatioSamples: count must be a positive integer; got ${count}`);
  }
  const inverseGolden = (Math.sqrt(5) - 1) / 2;
  const samples: number[] = [];
  // Starts at n = 1 rather than n = 0: frac(0) is 0, which would put the first
  // start exactly on the lower bound, where the reachable set often ends.
  for (let n = 1; n <= count; n += 1) {
    const x = n * inverseGolden;
    samples.push(x - Math.floor(x));
  }
  return samples;
}

/**
 * Starting elevations for a multi-start run, radians, ascending.
 *
 * Sorted before returning: the sequence itself is deliberately unordered, but a
 * caller reading {@link MultiStartResult.attempts} against a plot wants them in
 * elevation order, and sorting cannot change which points were sampled.
 */
export function multiStartAngles(minAngle: number, maxAngle: number, count: number): number[] {
  if (!Number.isFinite(minAngle) || !Number.isFinite(maxAngle)) {
    throw new Error(`multiStartAngles: bounds must be finite; got [${minAngle}, ${maxAngle}]`);
  }
  if (!(maxAngle > minAngle)) {
    throw new Error(
      `multiStartAngles: maxAngle must exceed minAngle; got [${minAngle}, ${maxAngle}]`,
    );
  }
  const span = maxAngle - minAngle;
  return goldenRatioSamples(count)
    .map((x) => minAngle + x * span)
    .sort((a, b) => a - b);
}

/**
 * Run a local solve from many starting elevations at one launch speed, and
 * report the distinct solutions found.
 *
 * This is the entry point P5.27's criterion is stated against. Nothing in it
 * knows that there are two arcs, where the maximum-range elevation is, or which
 * of the answers is the lofted one; the count and the labels are both results.
 *
 * @param residual  P5.04's residual for the problem being aimed.
 * @param speed     The launch speed to hold fixed, m/s.
 */
export function multiStart(
  residual: ResidualFunction,
  speed: number,
  options: MultiStartOptions = {},
): MultiStartResult {
  if (!Number.isFinite(speed) || !(speed > 0)) {
    throw new Error(`multiStart: speed must be finite and positive; got ${speed}`);
  }
  const minAngle = options.minAngle ?? 0.05;
  const maxAngle = options.maxAngle ?? Math.PI / 2 - 0.05;
  const startCount = options.startCount ?? 16;
  const downrangeTolerance = options.downrangeTolerance ?? 1e-3;
  const mergeTolerance = options.mergeTolerance ?? 1e-6;
  const slopeStep = options.slopeStep ?? 1e-4;
  const layout = options.layout ?? PLANAR_LAYOUT;
  const downrangeAxis = downrangeAxisOf(layout);

  if (!(downrangeTolerance > 0) || !Number.isFinite(downrangeTolerance)) {
    throw new Error(
      `multiStart: downrangeTolerance must be finite and positive; got ${downrangeTolerance}`,
    );
  }
  if (!(mergeTolerance > 0) || !Number.isFinite(mergeTolerance)) {
    throw new Error(
      `multiStart: mergeTolerance must be finite and positive; got ${mergeTolerance}`,
    );
  }
  if (!(slopeStep > 0) || !Number.isFinite(slopeStep)) {
    throw new Error(`multiStart: slopeStep must be finite and positive; got ${slopeStep}`);
  }

  const starts =
    options.starts !== undefined
      ? [...options.starts].sort((a, b) => a - b)
      : multiStartAngles(minAngle, maxAngle, startCount);
  if (starts.length === 0) {
    throw new Error("multiStart: at least one starting elevation is required");
  }

  // The degenerate box. `speedMin === speedMax` is the whole mechanism: P5.16's
  // projection clamps every iterate back onto that single speed, so the local
  // solve moves in elevation alone and the solution set it searches is the two
  // isolated roots rather than the curve. `validateAimBounds` permits the
  // equality; only min > max is rejected.
  const bounds: AimBounds = {
    thetaMin: minAngle,
    thetaMax: maxAngle,
    speedMin: speed,
    speedMax: speed,
  };

  let evaluations = 0;
  /** Downrange reached by `at`, or `undefined` if that aim never impacted. */
  const downrangeAt = (at: Aim): number | undefined => {
    evaluations += 1;
    const evaluation = residual(at);
    if (!evaluation.ok || evaluation.impact === null) return undefined;
    return evaluation.impact[downrangeAxis]!;
  };

  const attempts: MultiStartAttempt[] = [];
  const accepted: { theta: number; aim: Aim; downrangeMiss: number }[] = [];

  for (const start of starts) {
    const result = constrainedShooting(residual, { theta: start, speed }, bounds, options.newton);
    evaluations += result.newton.evaluations;

    const evaluation = result.newton.residual;
    if (!evaluation.ok || evaluation.residual === null) {
      attempts.push({
        start,
        aim: null,
        downrangeMiss: null,
        accepted: false,
        iterations: result.newton.iterations,
      });
      continue;
    }

    const downrangeMiss = evaluation.residual[downrangeAxis]!;
    const isAccepted = Math.abs(downrangeMiss) <= downrangeTolerance;
    attempts.push({
      start,
      aim: result.aim,
      downrangeMiss,
      accepted: isAccepted,
      iterations: result.newton.iterations,
    });
    if (isAccepted) accepted.push({ theta: result.aim.theta, aim: result.aim, downrangeMiss });
  }

  const clusters = clusterByElevation(accepted, mergeTolerance);

  const solutions: MultiStartSolution[] = clusters.map((cluster) => {
    // The representative is the smallest miss rather than the mean: averaging
    // two aims produces an aim that no solve ever visited and whose residual is
    // therefore unmeasured, which is not a solution, it is an interpolation.
    let best = cluster[0]!;
    for (const member of cluster) {
      if (Math.abs(member.downrangeMiss) < Math.abs(best.downrangeMiss)) best = member;
    }
    const members = cluster.map((member) => member.theta);
    const slope = rangeSlopeAt(downrangeAt, best.aim, slopeStep);
    return {
      aim: best.aim,
      branch: slope === undefined || slope === 0 ? "indeterminate" : slope > 0 ? "low" : "high",
      rangeSlope: slope ?? null,
      downrangeMiss: best.downrangeMiss,
      starts: cluster.length,
      spread: members[members.length - 1]! - members[0]!,
      members,
    };
  });

  let minimumSeparation = Number.POSITIVE_INFINITY;
  for (let i = 1; i < solutions.length; i += 1) {
    const gap = solutions[i]!.aim.theta - solutions[i - 1]!.aim.theta;
    if (gap < minimumSeparation) minimumSeparation = gap;
  }

  return {
    speed,
    solutions,
    attempts,
    accepted: accepted.length,
    minimumSeparation,
    evaluations,
  };
}

/**
 * Single-linkage clustering of converged elevations at one speed.
 *
 * Single linkage — a new member joins the current cluster when it is within
 * `tolerance` of the *previous* member, not of the cluster's first — because
 * the thing being collapsed is a set of numerically identical answers, and
 * their scatter is bounded by the solver's tolerance rather than by anything
 * that grows with cluster size. On a sorted list that is one pass.
 *
 * The failure mode it does have is worth naming: a chain of members each within
 * `tolerance` of the last can span far more than `tolerance` in total. That is
 * why {@link MultiStartSolution.spread} is reported. On this problem a chain
 * cannot form — converged elevations agree to `1e-12` and the default tolerance
 * is `1e-6` — but a caller who loosens the tolerance towards a genuine arc
 * separation is entitled to see it happening.
 */
function clusterByElevation(
  accepted: readonly { theta: number; aim: Aim; downrangeMiss: number }[],
  tolerance: number,
): { theta: number; aim: Aim; downrangeMiss: number }[][] {
  if (accepted.length === 0) return [];
  const sorted = [...accepted].sort((a, b) => a.theta - b.theta);
  const clusters: { theta: number; aim: Aim; downrangeMiss: number }[][] = [[sorted[0]!]];
  for (let i = 1; i < sorted.length; i += 1) {
    const previous = sorted[i - 1]!;
    const current = sorted[i]!;
    if (current.theta - previous.theta <= tolerance) {
      clusters[clusters.length - 1]!.push(current);
    } else {
      clusters.push([current]);
    }
  }
  return clusters;
}
