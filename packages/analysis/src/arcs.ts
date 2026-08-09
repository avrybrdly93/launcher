import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import {
  type RangeFunction,
  type RangeRoot,
  solveRangeRoot,
  solveRangeRoots,
} from "./range-root.js";
import {
  type Aim,
  type ResidualFunction,
  type ShootingProblem,
  type ShootingResidual,
  createShootingResidual,
} from "./shooting-residual.js";

/**
 * Multi-solution handling for §7 Phase 5 (P5.08): at a fixed launch speed, a
 * reachable target has **two** aims, and this module reports both with a stable
 * label rather than returning whichever one a solver happened to walk into.
 *
 * **Why this exists at all is P5.05's rank deficiency, read forwards.** A
 * ground-impact shot is one scalar equation — the downrange miss — in the two
 * unknowns `(θ, v₀)`, so its solution set is a *curve*, not a point. P5.06's
 * Newton solve handles that by refusing to move along the null direction, and
 * P5.07's initializer by picking the one point on the curve the geometry
 * determines. Both are answers to "give me *an* aim". This module answers the
 * other question: **fix the speed, and the curve meets that constraint twice.**
 * Downrange rises from the shallow end, peaks, and falls back off as the shot
 * goes vertical, so every distance strictly inside the envelope is reached by a
 * flat, fast **low arc** and a lofted **high arc**.
 *
 * **The bracketing is P5.03's, deliberately not reimplemented.**
 * `range-root.ts` already isolates the two branches either side of the peak,
 * and it takes the range function as a parameter precisely so that the
 * *integrated* range could be substituted for its drag-free closed form later —
 * its own doc comment says so. This module supplies that substitution: a
 * {@link RangeFunction} that flies the real trajectory through
 * `createShootingResidual` and reports where it landed.
 *
 * **What could not be reused is the peak angle**, and that is the one piece of
 * new numerics here. `solveRangeRoots` defaults to `DRAG_FREE_PEAK_ANGLE`
 * (π/4), which is exact for a drag-free launch from and to the same height and
 * wrong for everything else in the scenario library — drag pulls the
 * maximum-range elevation *down*, a raised launch pulls it down further, and a
 * headwind moves it again. A wrong peak does not merely lose accuracy: it puts
 * the branch boundary in the wrong place, so one bracket spans the true maximum
 * and holds two roots while the other holds none, and the labels stop meaning
 * what they say. So the peak is measured, by {@link locatePeakAngle}.
 *
 * **The UI half of the task's title belongs to P5.21.** "UI selects" is
 * satisfied by handing a UI two labelled, independently valid solutions to
 * choose between; the draggable target marker and the arc picker are P5.21's
 * own task, and building them here would be claiming it out of order. What this
 * module owes that task is a label a user can rely on, which is why
 * {@link ArcSolution} carries the physical distinction — the flight time, which
 * a lofted shot has strictly more of — and not just the bracket the root came
 * out of. `arcs.test.ts` checks the labels against *that* property rather than
 * against the bracket, so a swap could not pass by agreeing with itself.
 */

/**
 * Which of the two solutions an {@link ArcSolution} is.
 *
 * `"low"` is the flat, fast arc: the shallower elevation, lower apex, shorter
 * flight. `"high"` is the lofted one. The pair is ordered by elevation, and
 * every other difference between them follows from that.
 */
export type ArcLabel = "low" | "high";

/** One of the two aims that reach the target at the requested speed. */
export interface ArcSolution {
  /** Which arc this is. See {@link ArcLabel}. */
  readonly arc: ArcLabel;
  /** The aim: the solved elevation at the caller's fixed speed. */
  readonly aim: Aim;
  /** The residual evaluation at {@link aim} — the flight this solution describes. */
  readonly residual: ShootingResidual;
  /**
   * Signed downrange miss at {@link aim}, metres: negative is short, positive
   * is long. Reported rather than assumed zero, the same way
   * {@link RangeRoot.residual} is.
   */
  readonly downrangeMiss: number;
  /** Flight time to impact, seconds. Strictly larger for the high arc. */
  readonly timeOfFlight: number;
  /** `brentRoot` iterations spent isolating this arc. */
  readonly iterations: number;
}

/** Tuning for {@link solveArcs}. */
export interface ArcOptions {
  /** Lowest elevation considered, radians. Default `0`. */
  readonly minAngle?: number;
  /** Highest elevation considered, radians. Default `π/2`. */
  readonly maxAngle?: number;
  /**
   * Coarse samples used to bracket the maximum-range elevation. Default `24`.
   *
   * This is a *bracketing* count, not an accuracy knob — the refinement that
   * follows it is what sets the precision. It needs to be fine enough that the
   * sampled maximum's neighbours straddle the true one, which for a curve with
   * a single interior maximum only asks that no sample step skip the peak. 24
   * samples over 90° is a step of under 4°, comfortably inside the width of the
   * peak for every scenario in the library.
   */
  readonly sweepSamples?: number;
  /**
   * Absolute tolerance on the peak elevation, radians. Default `1e-4`.
   *
   * Deliberately loose next to `angleTol`'s `1e-12`, because the two are not
   * doing the same job. The peak only has to *separate the branches*: any value
   * between the two roots puts one root in each bracket, and the roots
   * themselves are then found to `angleTol` by Brent regardless. Refining the
   * peak further would cost trajectory integrations to buy precision nothing
   * downstream reads. A caller who wants the maximum range itself as a
   * *measurement* wants P5.09's envelope or P5.13's minimizer, not this.
   */
  readonly peakTol?: number;
  /** Absolute tolerance on each solved elevation, radians. Default `1e-12`. */
  readonly angleTol?: number;
  /** Iteration backstop for each Brent solve. Default `100`. */
  readonly maxIterations?: number;
  /**
   * The point on the target to match downrange against, in the layout's axis
   * order. Defaults to the target's `center`, matching
   * {@link smartInitialAim}'s default and for the same reason.
   */
  readonly aimPoint?: readonly number[];
}

/** What {@link solveArcs} returns. */
export interface ArcPair {
  /**
   * Whether the target's downrange is within reach at this speed — that is, no
   * greater than {@link maxDownrange}.
   *
   * False implies both arcs are `null`; the converse does not hold, because an
   * angle bound can exclude an arc that exists. See {@link ArcPair.low}.
   */
  readonly reachable: boolean;
  /**
   * The flat, fast arc, or `null` when `[minAngle, maxAngle]` excludes it.
   *
   * Independently nullable from {@link high}, inheriting P5.03's reasoning: a
   * launcher that cannot depress below 20° has no flat arc to a target inside
   * its 20° range, while the lofted arc to that same target is still there to
   * fire. Reporting one arc and `null` says exactly that.
   *
   * A `null` alongside a {@link peakAngle} sitting *on* `minAngle` or
   * `maxAngle` is the stronger statement that the range curve is monotone
   * across the whole interval, so only one branch exists to solve — see
   * `solveBranches`.
   */
  readonly low: ArcSolution | null;
  /** The lofted arc, or `null` when the angle bounds exclude it. See {@link low}. */
  readonly high: ArcSolution | null;
  /** The launch speed both arcs were solved at, m/s. */
  readonly speed: number;
  /** The measured maximum-range elevation, radians. See {@link locatePeakAngle}. */
  readonly peakAngle: number;
  /** Downrange reached at {@link peakAngle}, metres — this speed's envelope. */
  readonly maxDownrange: number;
  /** Target downrange this call was solving for, metres from the launch point. */
  readonly targetDownrange: number;
  /** How far the target exceeded {@link maxDownrange}, metres; `0` when reachable. */
  readonly shortfall: number;
  /** Trajectory integrations spent, sweep and both root solves included. */
  readonly evaluations: number;
}

/** What {@link locatePeakAngle} returns. */
export interface PeakAngle {
  /** The maximum-range elevation, radians. */
  readonly theta: number;
  /** Downrange there, metres. */
  readonly downrange: number;
  /** Range evaluations spent. */
  readonly evaluations: number;
}

const INVERSE_GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * The elevation of maximum range for a range function, by a coarse sweep
 * followed by golden-section refinement.
 *
 * **Golden section, not a derivative method, because the range function here is
 * an integration.** Each evaluation flies a trajectory, so a difference
 * quotient would cost two of them and hand back a derivative contaminated by
 * whatever step-sequence noise the adaptive solver leaves — the same reason
 * P5.05's Jacobian needs a tighter tolerance than the app's working one.
 * Golden section needs no derivative, contracts the bracket by a fixed factor
 * per evaluation, and cannot be misled by noise into stepping outside a bracket
 * it has already proved contains the maximum.
 *
 * **The sweep is what makes the refinement legitimate.** Golden section
 * requires a bracket known to hold a single interior maximum, and it is the
 * sweep — not an assumption about drag — that establishes one: the sampled
 * argmax and its two neighbours straddle the true maximum whenever the sampling
 * is fine enough not to step over the peak.
 *
 * **A sampled maximum at an endpoint is reported, not refined.** A range
 * function whose largest sample sits at `minAngle` or `maxAngle` has its
 * maximum on the boundary as far as this bracket can tell, and there is no
 * interior triple to contract. That is a real situation — an angle bound
 * clipping the peak off — and the honest answer is the endpoint, which
 * {@link solveArcs} then hands to `solveRangeRoots`, whose own precondition
 * check rejects a peak that is not strictly inside the bounds. Inventing an
 * interior bracket to avoid the error would move the branch boundary somewhere
 * the range function never said it was.
 */
export function locatePeakAngle(
  rangeFn: RangeFunction,
  minAngle: number,
  maxAngle: number,
  sweepSamples: number,
  peakTol: number,
): PeakAngle {
  if (!(maxAngle > minAngle)) {
    throw new Error(`locatePeakAngle: maxAngle ${maxAngle} must exceed minAngle ${minAngle}`);
  }
  if (!Number.isInteger(sweepSamples) || sweepSamples < 3) {
    throw new Error(`locatePeakAngle: sweepSamples must be an integer >= 3; got ${sweepSamples}`);
  }
  if (!(peakTol > 0)) {
    throw new Error(`locatePeakAngle: peakTol must be positive; got ${peakTol}`);
  }

  let evaluations = 0;
  const evaluate = (theta: number): number => {
    evaluations++;
    return rangeFn(theta);
  };

  const step = (maxAngle - minAngle) / (sweepSamples - 1);
  let bestIndex = 0;
  let bestRange = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < sweepSamples; i++) {
    const value = evaluate(minAngle + i * step);
    if (value > bestRange) {
      bestRange = value;
      bestIndex = i;
    }
  }

  if (bestIndex === 0 || bestIndex === sweepSamples - 1) {
    return { theta: minAngle + bestIndex * step, downrange: bestRange, evaluations };
  }

  // Golden-section contraction on the bracketing triple. Both interior probes
  // are kept across iterations so each step costs one evaluation, not two.
  let a = minAngle + (bestIndex - 1) * step;
  let b = minAngle + (bestIndex + 1) * step;
  let c = b - INVERSE_GOLDEN * (b - a);
  let d = a + INVERSE_GOLDEN * (b - a);
  let fc = evaluate(c);
  let fd = evaluate(d);
  while (b - a > peakTol) {
    if (fc > fd) {
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

  const theta = (a + b) / 2;
  return { theta, downrange: evaluate(theta), evaluations };
}

/**
 * Both aims that put the impact at the target's downrange, at a fixed launch
 * speed.
 *
 * **Downrange is the coordinate matched, and that is a statement about the
 * problem rather than a simplification.** P5.05 measured the shooting
 * Jacobian's vertical row as zero to `<1e-8`: a ground-impact terminal event
 * pins the impact height for *every* aim, so no elevation and no speed can move
 * it. The vertical component of the miss is therefore irreducible — the same
 * reason P5.06 reports `"stalled"` as a legitimate terminal state — and the
 * solvable equation is the downrange one. A target above the ground still gets
 * a well-defined pair of arcs; what it does not get is a zero vertical miss,
 * which is visible in each solution's {@link ArcSolution.residual} rather than
 * hidden by it.
 *
 * @param problem The shooting problem. Its `target` supplies the downrange to
 *   match; its `model`, `ctx`, `config` and `stepper` fly the trajectories.
 * @param speed The fixed launch speed, m/s. This is the parameter that turns an
 *   under-determined curve into an isolated pair.
 * @throws If `speed` is not finite and positive, or if an aim inside the angle
 *   bounds produces no impact (see below).
 *
 * **A non-impacting aim inside the bounds throws rather than being scored as a
 * short shot.** Scoring it would be the more forgiving choice and the wrong
 * one: a shot that runs out of `tspan` without reaching the ground has no range
 * at all, and feeding a sentinel to a bracketing method would produce a
 * confidently converged root of a function that does not exist there. It means
 * the problem is misconfigured — a `tspan` too short for a lofted shot is the
 * usual cause, since the high arc flies far longer than the aim a caller sized
 * the span against — and the message says so.
 */
export function solveArcs(
  problem: ShootingProblem,
  speed: number,
  options: ArcOptions = {},
): ArcPair {
  if (!Number.isFinite(speed) || !(speed > 0)) {
    throw new Error(`solveArcs: speed must be finite and positive; got ${speed}`);
  }
  const minAngle = options.minAngle ?? 0;
  const maxAngle = options.maxAngle ?? Math.PI / 2;
  const sweepSamples = options.sweepSamples ?? 24;
  const peakTol = options.peakTol ?? 1e-4;
  const angleTol = options.angleTol ?? 1e-12;
  const maxIterations = options.maxIterations ?? 100;

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const dim = layout.position.length;
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  const aimPoint = options.aimPoint ?? problem.target.center;
  if (launchPoint.length !== dim || aimPoint.length !== dim) {
    throw new Error(
      `solveArcs: launch point (${launchPoint.length}) and aim point (${aimPoint.length}) must ` +
        `both have ${dim} component(s) for this layout`,
    );
  }

  const downrangeAxis = downrangeAxisOf(layout);
  const launchDownrange = launchPoint[downrangeAxis]!;
  const targetDownrange = aimPoint[downrangeAxis]! - launchDownrange;

  const residual: ResidualFunction = createShootingResidual(problem);
  let evaluations = 0;
  const evaluateAt = (theta: number): ShootingResidual => {
    evaluations++;
    const evaluation = residual({ theta, speed });
    if (!evaluation.ok) {
      throw new Error(
        `solveArcs: the aim θ = ${theta} rad at v₀ = ${speed} m/s reached no impact ` +
          `(${evaluation.report.failure ?? evaluation.report.status}), so it has no range to ` +
          "match; widen the problem's tspan or narrow the angle bounds",
      );
    }
    return evaluation;
  };
  const rangeFn: RangeFunction = (theta) =>
    evaluateAt(theta).impact![downrangeAxis]! - launchDownrange;

  const peak = locatePeakAngle(rangeFn, minAngle, maxAngle, sweepSamples, peakTol);
  const roots = solveBranches(rangeFn, targetDownrange, peak, {
    minAngle,
    maxAngle,
    angleTol,
    maxIterations,
  });

  return {
    reachable: roots.reachable,
    low: describe(
      roots.low,
      "low",
      speed,
      evaluateAt,
      targetDownrange,
      downrangeAxis,
      launchDownrange,
    ),
    high: describe(
      roots.high,
      "high",
      speed,
      evaluateAt,
      targetDownrange,
      downrangeAxis,
      launchDownrange,
    ),
    speed,
    peakAngle: peak.theta,
    maxDownrange: peak.downrange,
    targetDownrange,
    shortfall: roots.shortfall,
    evaluations: evaluations,
  };
}

/** The two branch roots, before either is turned into an {@link ArcSolution}. */
interface BranchRoots {
  readonly reachable: boolean;
  readonly low: RangeRoot | null;
  readonly high: RangeRoot | null;
  readonly shortfall: number;
}

/**
 * Splits the angle interval at the measured peak and solves each branch.
 *
 * **The peak is not always interior, and a boundary peak is a different
 * problem rather than an error.** `solveRangeRoots` requires a peak strictly
 * inside the bounds, which is right for it — with no interior maximum there are
 * no two branches to bracket, and it should not pretend otherwise. But "no
 * interior maximum" is a situation this task's own scenario library produces:
 * `density-altitude-2000m` launches from 2000 m and `dust-grain` is a micron
 * particle in Stokes drag, and for both the downrange carry *falls* across the
 * whole of `[0, π/2]`. There is no peak inside the bounds to fly over because
 * the flat arc to any reachable target would need a **depression** — a negative
 * elevation the default bounds exclude — and the range curve is monotone on
 * what is left.
 *
 * So a boundary peak is handled as the monotone branch it is:
 *
 * - **Peak at `minAngle`** — range only falls, so the whole interval lies
 *   *above* the maximum-range elevation and every solution on it is a lofted
 *   one. The single root is labelled `"high"` and `low` is `null`.
 * - **Peak at `maxAngle`** — range only rises, the whole interval is below the
 *   peak, the root is the flat arc: `"low"`, with `high` null.
 *
 * That keeps the labels meaning one thing throughout — `"low"` is flatter than
 * the maximum-range elevation, `"high"` is loftier — instead of making them
 * mean "whichever of the two we found" in the two-arc case and something else
 * here. A caller that needs both arcs for such a scenario has to widen
 * `minAngle` below zero, and the `null` plus a `peakAngle` sitting on the bound
 * is what tells it so.
 */
function solveBranches(
  rangeFn: RangeFunction,
  targetDownrange: number,
  peak: PeakAngle,
  bounds: {
    minAngle: number;
    maxAngle: number;
    angleTol: number;
    maxIterations: number;
  },
): BranchRoots {
  const { minAngle, maxAngle, angleTol, maxIterations } = bounds;
  const options = { angleTol, maxIterations };

  if (peak.theta > minAngle && peak.theta < maxAngle) {
    const roots = solveRangeRoots(rangeFn, targetDownrange, {
      peakAngle: peak.theta,
      minAngle,
      maxAngle,
      ...options,
    });
    return {
      reachable: roots.reachable,
      low: roots.low,
      high: roots.high,
      shortfall: roots.shortfall,
    };
  }

  if (targetDownrange > peak.downrange) {
    return { reachable: false, low: null, high: null, shortfall: targetDownrange - peak.downrange };
  }

  // Monotone across the whole interval. The far endpoint decides whether the
  // target is attained on it at all — the near one is the peak, already known
  // to be no closer than the target.
  const descending = peak.theta <= minAngle;
  const attained = rangeFn(descending ? maxAngle : minAngle) <= targetDownrange;
  const root = attained
    ? solveRangeRoot(rangeFn, targetDownrange, minAngle, maxAngle, options)
    : null;
  return {
    reachable: true,
    low: descending ? null : root,
    high: descending ? root : null,
    shortfall: 0,
  };
}

/**
 * Turns a converged {@link RangeRoot} into an {@link ArcSolution} by flying the
 * solved aim once more.
 *
 * The extra integration buys the full {@link ShootingResidual} — impact point,
 * flight time, solve report — which `solveRangeRoots` never sees, because the
 * range function it was handed reduces every flight to one number. Recomputing
 * the miss from that flight rather than reusing `root.residual` also keeps the
 * reported miss and the reported trajectory describing the same integration.
 */
function describe(
  root: RangeRoot | null,
  arc: ArcLabel,
  speed: number,
  evaluateAt: (theta: number) => ShootingResidual,
  targetDownrange: number,
  downrangeAxis: number,
  launchDownrange: number,
): ArcSolution | null {
  if (root === null) return null;
  const evaluation = evaluateAt(root.theta);
  return {
    arc,
    aim: { theta: root.theta, speed },
    residual: evaluation,
    downrangeMiss: evaluation.impact![downrangeAxis]! - launchDownrange - targetDownrange,
    timeOfFlight: evaluation.timeOfFlight!,
    iterations: root.iterations,
  };
}

/**
 * The axis the aim's horizontal velocity goes into: the first that is not
 * vertical.
 *
 * The same one-line rule `shooting-residual.ts`'s `launchState` and
 * `smart-init.ts` each state, for the same reason they state it — all three
 * have to agree, and a disagreement shows up as a solver matching the wrong
 * coordinate rather than as an error. `arcs.test.ts` pins the agreement.
 */
function downrangeAxisOf(layout: TrajectoryLayout): number {
  return layout.vertical === 0 ? 1 : 0;
}
