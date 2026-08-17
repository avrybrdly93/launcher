import { G_STD } from "@ballista/engine";
import { brentRoot } from "@ballista/solverkit";
import { type ArcLabel, type ArcOptions, solveArcs } from "./arcs.js";
import { PLANAR_LAYOUT, downrangeAxisOf } from "./observables.js";
import {
  type Aim,
  type ResidualFunction,
  type ShootingProblem,
  type ShootingResidual,
  createShootingResidual,
} from "./shooting-residual.js";

/**
 * Trajectory-designer mode for §7 Phase 5 (P5.22): **lock any two of
 * (θ, v₀, R), solve the third.**
 *
 * The three locks are not three variations on one solve. They are three
 * genuinely different problems that happen to share a state space, and the
 * differences are the whole content of this module:
 *
 * | locked | unknown | what it costs | how many answers |
 * | --- | --- | --- | --- |
 * | θ, v₀ | R | one flight | exactly one |
 * | v₀, R | θ | a peak location and two Brent solves | **two**, or none |
 * | θ, R | v₀ | a bracket expansion and one Brent solve | one, or none |
 *
 * **Solving for R is not a solve at all.** With both aim components fixed
 * there is nothing to iterate: fly it and read where it landed. It is included
 * because the task's phrasing is "lock any two", and a designer UI that
 * silently refuses the one combination needing no numerics would be a strange
 * thing to hand a user. It is also the only lock that cannot fail on
 * feasibility grounds — every aim that reaches the ground has *a* range, even
 * if it is not one anybody wants.
 *
 * **Solving for θ is P5.08's, delegated rather than re-derived.** At a fixed
 * speed a reachable target has two aims — a flat low arc and a lofted high one
 * — and {@link solveArcs} already finds both, measures the peak that separates
 * them rather than assuming π/4, and labels them by a physical property.
 * Re-implementing any of that here to get a single "the" angle would both
 * duplicate it and throw away the second solution, which for a designer is the
 * interesting half of the answer.
 *
 * **Solving for v₀ is the one piece of new numerics**, and it is easier than
 * the θ solve for a structural reason worth stating: *range is monotone in
 * speed*. Fire the same elevation harder and it goes further, without a peak
 * anywhere in between, so unlike the angle problem there is no branch
 * structure, no peak to locate, and at most one root. That is why this lock
 * returns a single solution and the θ lock returns two, and it is a fact about
 * the physics rather than a choice made here.
 *
 * The monotonicity is exploited but not *assumed* blindly: the bracket is
 * grown until it genuinely straddles the target range, and a cap that is
 * reached without straddling is reported as {@link "unreachable"} rather than
 * being solved past. See {@link solveForSpeed}.
 *
 * **What "R" means here.** Downrange displacement *from the launch point*,
 * along the layout's downrange axis — not the distance from the origin, and
 * not slant range. A raised launch is a first-class case throughout this
 * package (see `shooting-residual.ts`), so measuring from the launcher rather
 * than from the coordinate origin is the only reading that keeps the three
 * locks consistent with each other.
 */

/** Which of the three quantities the caller wants solved. */
export type DesignUnknown = "range" | "speed" | "theta";

/**
 * A designer request: exactly two of (θ, v₀, R) supplied, the third named as
 * the unknown.
 *
 * Modelled as a discriminated union rather than as three optional fields so
 * that "lock any **two**" is enforced by the type checker. A single
 * `{theta?, speed?, range?}` bag would admit all eight subsets, seven of which
 * are meaningless, and would push the arity check to runtime for no gain.
 */
export type DesignRequest =
  | {
      readonly solveFor: "range";
      /** Elevation, radians from the horizontal. */
      readonly theta: number;
      /** Launch speed, m/s. */
      readonly speed: number;
    }
  | {
      readonly solveFor: "speed";
      readonly theta: number;
      /** Downrange from the launch point, metres. */
      readonly range: number;
    }
  | {
      readonly solveFor: "theta";
      readonly speed: number;
      readonly range: number;
    };

/** Why a request produced no solution. `null` on success. */
export type DesignFailure =
  /** The requested range exceeds what the locked quantity can achieve. */
  | "unreachable"
  /** The locked elevation cannot produce positive downrange at any speed. */
  | "degenerate-elevation"
  /** A requested range at or below zero; nothing to solve towards. */
  | "non-positive-range"
  /** The bracket straddled the target but Brent hit its iteration cap. */
  | "max-iterations";

/** One fully determined design: all three of θ, v₀ and R, however they were obtained. */
export interface DesignSolution {
  /** The complete aim — the locked component and the solved one together. */
  readonly aim: Aim;
  /** Downrange achieved from the launch point, metres. */
  readonly range: number;
  /**
   * Which arc this is, for the `"theta"` lock; `null` for the other two, whose
   * answers are unique and so have no branch to name.
   */
  readonly arc: ArcLabel | null;
  /**
   * Signed downrange miss against the requested range, metres — negative
   * short, positive long. Zero by construction for the `"range"` lock, since
   * that lock has no request to miss.
   *
   * Reported rather than assumed zero for the same reason `arcs.ts` reports
   * it: a converged root is not an exact one, and a caller comparing designs
   * deserves to see which of them actually landed on the target.
   */
  readonly downrangeMiss: number;
  /** The residual evaluation this solution was read off — the flight itself. */
  readonly residual: ShootingResidual;
}

/** The outcome of a designer request. */
export interface DesignResult {
  /** Echo of the request's unknown, so a result is interpretable on its own. */
  readonly solveFor: DesignUnknown;
  /**
   * The solutions found, ordered by elevation. Length 1 for `"range"` and
   * `"speed"`, **0, 1 or 2** for `"theta"` — two for a reachable target, one
   * when an angle bound excludes an arc, none when the target is out of reach.
   */
  readonly solutions: readonly DesignSolution[];
  /** True when at least one solution was found. */
  readonly feasible: boolean;
  /** Why not, when {@link feasible} is false; `null` otherwise. */
  readonly failure: DesignFailure | null;
  /** Trajectory integrations spent. The designer's real cost is flights, not iterations. */
  readonly evaluations: number;
}

/** Tuning for the `"speed"` lock's bracket search. Defaults suit the scenario library. */
export interface SpeedSolveOptions {
  /** Lower bound on launch speed, m/s. Default `1e-3`. */
  readonly minSpeed?: number;
  /** Cap on launch speed, m/s. Reaching it without a bracket is `"unreachable"`. Default `2000`. */
  readonly maxSpeed?: number;
  /** Geometric growth per expansion step. Default `2`. */
  readonly expansionFactor?: number;
  /** Expansion attempts before giving up. Default `40`. */
  readonly maxExpansions?: number;
  /** Absolute convergence tolerance on speed, m/s. Default `1e-9`. */
  readonly speedTol?: number;
  /** Brent iteration cap. Default `100`. */
  readonly maxIterations?: number;
}

/** Options for {@link designTrajectory}; the `"theta"` lock's are P5.08's. */
export interface DesignOptions extends SpeedSolveOptions {
  /** Passed through to {@link solveArcs} for the `"theta"` lock. */
  readonly arcs?: ArcOptions;
}

/**
 * Solves one designer request.
 *
 * Dispatches on {@link DesignRequest.solveFor}; see the module comment for why
 * the three branches look so different from each other.
 */
export function designTrajectory(
  problem: ShootingProblem,
  request: DesignRequest,
  options: DesignOptions = {},
): DesignResult {
  switch (request.solveFor) {
    case "range":
      return solveForRange(problem, request.theta, request.speed);
    case "speed":
      return solveForSpeed(problem, request.theta, request.range, options);
    case "theta":
      return solveForTheta(problem, request.speed, request.range, options);
  }
}

/* ------------------------------------------------------------------ */
/* Lock (θ, v₀) → R                                                     */
/* ------------------------------------------------------------------ */

function solveForRange(problem: ShootingProblem, theta: number, speed: number): DesignResult {
  requireFinite("theta", theta);
  requirePositive("speed", speed);

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchDownrange = (problem.launchPoint ?? layout.position.map(() => 0))[axis]!;

  const residual: ResidualFunction = createShootingResidual(problem);
  const evaluation = residual({ theta, speed });
  if (!evaluation.ok) {
    // No impact means no range. Reported as a value, not thrown, for the reason
    // `shooting-residual.ts` gives at length: a designer sweeping elevations
    // will walk into aims that never come down, and that is an ordinary
    // incident in a sweep rather than a bug.
    return {
      solveFor: "range",
      solutions: [],
      feasible: false,
      failure: "unreachable",
      evaluations: 1,
    };
  }

  const range = evaluation.impact![axis]! - launchDownrange;
  return {
    solveFor: "range",
    solutions: [
      {
        aim: { theta, speed },
        range,
        arc: null,
        // The range lock requests no particular range, so there is nothing to
        // miss. Zero here is exact, not converged.
        downrangeMiss: 0,
        residual: evaluation,
      },
    ],
    feasible: true,
    failure: null,
    evaluations: 1,
  };
}

/* ------------------------------------------------------------------ */
/* Lock (θ, R) → v₀                                                     */
/* ------------------------------------------------------------------ */

/**
 * Solves `range(v₀ ; θ fixed) = R` for the launch speed.
 *
 * Range is monotone increasing in speed at fixed elevation, so there is at
 * most one root and no branch structure — the contrast with the θ lock that
 * the module comment draws. The work is therefore all in the bracket:
 *
 * - The **initial guess** is the drag-free inverse `v₀ = √(gR / sin 2θ)`,
 *   which is exact when there is no drag and a strict *under*-estimate when
 *   there is, since drag can only shorten a shot. Starting from an
 *   under-estimate means the expansion below almost always runs upwards, in
 *   the direction the bracket is guaranteed to be.
 * - The **expansion** grows geometrically to `maxSpeed`, following
 *   `min-energy.ts`, which brackets on speed the same way. Hitting the cap
 *   without a sign change is `"unreachable"` — reported, not solved past.
 * - Elevations with `sin 2θ ≤ 0` (θ at or below 0, at or above π/2) have no
 *   drag-free inverse and, from a ground launch, no positive downrange at any
 *   speed. Those are rejected up front as `"degenerate-elevation"` rather
 *   than left for the expansion loop to discover by exhausting its budget.
 *   A *raised* launcher does reach downrange at θ = 0, which is why the check
 *   is on the guess being unavailable rather than on the geometry being
 *   hopeless — see the fallback seed below.
 */
function solveForSpeed(
  problem: ShootingProblem,
  theta: number,
  range: number,
  options: DesignOptions,
): DesignResult {
  requireFinite("theta", theta);
  if (!Number.isFinite(range) || !(range > 0)) {
    return {
      solveFor: "speed",
      solutions: [],
      feasible: false,
      failure: "non-positive-range",
      evaluations: 0,
    };
  }

  const minSpeed = options.minSpeed ?? 1e-3;
  const maxSpeed = options.maxSpeed ?? 2000;
  const expansionFactor = options.expansionFactor ?? 2;
  const maxExpansions = options.maxExpansions ?? 40;
  const speedTol = options.speedTol ?? 1e-9;
  const maxIterations = options.maxIterations ?? 100;

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchDownrange = (problem.launchPoint ?? layout.position.map(() => 0))[axis]!;
  const residual: ResidualFunction = createShootingResidual(problem);

  let evaluations = 0;
  /**
   * Signed miss at a speed: reached downrange minus the request.
   *
   * A speed that never comes down is treated as `-Infinity` — infinitely
   * short — rather than as an error. That is the correct sign for the
   * bracket: such aims sit at the *bottom* of the speed range only in
   * pathological setups, and giving them a definite sign keeps the expansion
   * monotone instead of aborting a search that would have succeeded one step
   * later.
   */
  const missAt = (speed: number): { miss: number; evaluation: ShootingResidual } => {
    evaluations++;
    const evaluation = residual({ theta, speed });
    if (!evaluation.ok) return { miss: Number.NEGATIVE_INFINITY, evaluation };
    return { miss: evaluation.impact![axis]! - launchDownrange - range, evaluation };
  };

  const sin2Theta = Math.sin(2 * theta);
  // The drag-free inverse, when the geometry admits one. A ground launch at
  // θ ≤ 0 or θ ≥ π/2 has no positive-range solution at any speed and is
  // rejected; a raised launcher does, so it falls back to a plain seed and
  // lets the expansion find the bracket.
  let seed: number;
  if (sin2Theta > 0) {
    seed = Math.sqrt((G_STD * range) / sin2Theta);
    if (!Number.isFinite(seed) || !(seed > 0)) seed = 1;
  } else {
    const raised = (problem.launchPoint ?? layout.position.map(() => 0))[layout.vertical]! > 0;
    if (!raised) {
      return {
        solveFor: "speed",
        solutions: [],
        feasible: false,
        failure: "degenerate-elevation",
        evaluations: 0,
      };
    }
    seed = 1;
  }

  let low = Math.max(minSpeed, Math.min(seed, maxSpeed));
  let high = low;
  let atLow = missAt(low);
  let atHigh = atLow;
  let bracketed = false;

  if (atLow.miss > 0) {
    // The seed already overshoots: contract downwards for a speed that falls
    // short. Reachable when drag is absent and the seed is exact to rounding,
    // or when the launcher is raised enough that the drag-free inverse
    // over-estimates.
    high = low;
    atHigh = atLow;
    for (let i = 0; i < maxExpansions; i++) {
      const next = low / expansionFactor;
      if (!(next > 0) || next < minSpeed) break;
      low = next;
      atLow = missAt(low);
      if (atLow.miss <= 0) {
        bracketed = true;
        break;
      }
    }
  } else {
    // The seed falls short (the usual case with drag): expand upwards.
    for (let i = 0; i < maxExpansions; i++) {
      const next = Math.min(high * expansionFactor, maxSpeed);
      if (!(next > high)) break; // at the cap
      high = next;
      atHigh = missAt(high);
      if (atHigh.miss >= 0) {
        bracketed = true;
        break;
      }
    }
  }

  if (!bracketed) {
    // An exact hit at the seed is a solution, not a failed bracket.
    if (atLow.miss === 0) return speedSolution(theta, low, range, atLow, evaluations);
    return {
      solveFor: "speed",
      solutions: [],
      feasible: false,
      failure: "unreachable",
      evaluations,
    };
  }

  const root = brentRoot(
    (speed) => missAt(speed).miss,
    low,
    high,
    atLow.miss,
    atHigh.miss,
    () => speedTol,
    maxIterations,
  );

  // Re-fly the converged speed so the returned residual is the one belonging to
  // the reported aim, rather than whichever trial point Brent happened to
  // evaluate last.
  const final = missAt(root.x);
  if (!root.converged) {
    return {
      solveFor: "speed",
      solutions: [],
      feasible: false,
      failure: "max-iterations",
      evaluations,
    };
  }
  return speedSolution(theta, root.x, range, final, evaluations);
}

function speedSolution(
  theta: number,
  speed: number,
  range: number,
  at: { miss: number; evaluation: ShootingResidual },
  evaluations: number,
): DesignResult {
  return {
    solveFor: "speed",
    solutions: [
      {
        aim: { theta, speed },
        range: range + at.miss,
        arc: null,
        downrangeMiss: at.miss,
        residual: at.evaluation,
      },
    ],
    feasible: true,
    failure: null,
    evaluations,
  };
}

/* ------------------------------------------------------------------ */
/* Lock (v₀, R) → θ                                                     */
/* ------------------------------------------------------------------ */

/**
 * Solves for the elevation(s) reaching `range` at the locked speed, by handing
 * the whole problem to P5.08's {@link solveArcs}.
 *
 * The only work here is translation. `solveArcs` aims at the *problem's
 * target*, whereas the designer is given a bare downrange number, so the
 * request is expressed as an `aimPoint` offset from the launch point along the
 * downrange axis — the same option `solveArcs` already exposes for exactly
 * this. Both arcs are returned when both exist; the ordering is P5.08's
 * (low first), and this module does not re-sort them.
 */
function solveForTheta(
  problem: ShootingProblem,
  speed: number,
  range: number,
  options: DesignOptions,
): DesignResult {
  requirePositive("speed", speed);
  if (!Number.isFinite(range) || !(range > 0)) {
    return {
      solveFor: "theta",
      solutions: [],
      feasible: false,
      failure: "non-positive-range",
      evaluations: 0,
    };
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  // Aim at the launcher's own height, offset downrange by the request: the
  // designer's R is a downrange displacement, not a point in the world.
  const aimPoint = launchPoint.map((component, index) =>
    index === axis ? component + range : component,
  );

  const pair = solveArcs(problem, speed, { ...options.arcs, aimPoint });

  const solutions: DesignSolution[] = [];
  for (const arc of [pair.low, pair.high]) {
    if (arc === null) continue;
    solutions.push({
      aim: arc.aim,
      range: range + arc.downrangeMiss,
      arc: arc.arc,
      downrangeMiss: arc.downrangeMiss,
      residual: arc.residual,
    });
  }

  return {
    solveFor: "theta",
    solutions,
    feasible: solutions.length > 0,
    failure: solutions.length > 0 ? null : "unreachable",
    evaluations: pair.evaluations,
  };
}

/* ------------------------------------------------------------------ */
/* Argument checks                                                      */
/* ------------------------------------------------------------------ */

function requireFinite(name: string, value: number): void {
  if (!Number.isFinite(value)) {
    throw new Error(`designTrajectory: ${name} must be finite; got ${value}`);
  }
}

function requirePositive(name: string, value: number): void {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new Error(`designTrajectory: ${name} must be finite and positive; got ${value}`);
  }
}
