import { brentRoot } from "@ballista/solverkit";
import { type ArcLabel, type ArcOptions, type ArcSolution, solveArcs } from "./arcs.js";
import { PLANAR_LAYOUT, type TrajectoryLayout } from "./observables.js";
import {
  type ShootingProblem,
  type ShootingResidual,
  createShootingResidual,
} from "./shooting-residual.js";

/**
 * P5.22 — trajectory-designer mode: lock any two of (θ, v₀, R), solve the third.
 *
 * The three combinations are not three algorithms. Two of them are already in
 * this package and the third is a forward evaluation, so what this module adds
 * is the thing that was actually missing: **one definition of R that all three
 * share**, and one shape of answer, so a designer UI can switch which field is
 * locked without switching which question it is asking.
 *
 * ## What R means, everywhere in this file
 *
 * The downrange of the **terminal-event impact point**, measured from the
 * launch point along the layout's downrange axis. Not the distance to the
 * target, not the slant range, and not the downrange of the target's centre.
 *
 * That definition is taken from `solveArcs`, which solves
 * `impact[downrange] - launchDownrange = R`. Choosing it here rather than
 * inventing one is the whole reason the three combinations agree: solve for v₀
 * at a locked (θ, R), then re-lock (θ, v₀) and solve for R, and you get the R
 * you started with. `designRoundTripsThroughEveryPair` asserts exactly that,
 * and it would fail against any other reading of "range".
 *
 * It also means a raised target changes nothing about R. The target's height
 * decides where the terminal event fires — a platform is part of the dynamics —
 * but R is read off the impact the event produced, whatever height that was at.
 *
 * ## Why one combination returns two answers and the others return one
 *
 * `range(θ)` at fixed v₀ rises to the maximum-range elevation and falls again,
 * so a reachable R has **two** aims: P5.08's low and high arcs. `range(v₀)` at
 * fixed θ is monotone — more speed, more range, with drag as without — so
 * solving for v₀ has one answer. Solving for R is not a root problem at all.
 *
 * Rather than have three return types, every combination returns a list. The
 * list has two entries for the θ solve and one for the others, and `arc` is
 * `null` on the entries where no arc question was asked, because labelling a
 * solved v₀ "low" would be inventing a distinction the problem does not have.
 *
 * The monotonicity claim is load-bearing for the v₀ solve — a bracketing method
 * on a non-monotone function converges to *a* root and calls it *the* root — so
 * it is measured rather than asserted from theory in
 * `rangeIsMonotoneInSpeed`.
 */

/** Which of the three quantities a designer request leaves free. */
export type DesignVariable = "theta" | "speed" | "range";

/**
 * A designer request: exactly two of the three fields present.
 *
 * Two is not a stylistic preference. Three is over-determined — the third value
 * is almost never the one the physics produces, so the request would be asking
 * for something unsatisfiable while looking like a valid one. One is
 * under-determined: a locked v₀ alone admits a whole curve of (θ, R). Both are
 * rejected by {@link designTrajectory} rather than resolved by a default, since
 * a default here would silently answer a different question than the one asked.
 */
export interface DesignRequest {
  /** Elevation, radians. */
  readonly theta?: number;
  /** Launch speed, m/s. */
  readonly speed?: number;
  /** Downrange at impact, metres from the launch point. See the module note. */
  readonly range?: number;
}

/** Tuning for {@link designTrajectory}. */
export interface DesignOptions extends ArcOptions {
  /**
   * Bracket for the v₀ solve, m/s. Default `[1, 400]`.
   *
   * A bracket rather than an initial guess, because `range(v₀)` is monotone: a
   * bracket that spans the answer *is* the convergence proof, where a guess and
   * a step size are only a hope. The lower bound is 1 and not 0 because a zero
   * launch speed has no flight to integrate.
   *
   * A target beyond the range at the upper bound is reported as infeasible with
   * the shortfall attached, not thrown — "this launcher cannot throw that far"
   * is an answer a designer UI wants to display.
   */
  readonly speedBounds?: readonly [number, number];
  /** Absolute tolerance on the solved speed, m/s. Default `1e-9`. */
  readonly speedTol?: number;
}

/** One aim the designer produced. */
export interface DesignSolution {
  /** Elevation, radians — locked or solved. */
  readonly theta: number;
  /** Launch speed, m/s — locked or solved. */
  readonly speed: number;
  /** Downrange at impact, metres from the launch point — locked or solved. */
  readonly range: number;
  /**
   * Which arc this is, or `null` when θ was locked.
   *
   * Non-null only for the θ solve, which is the only combination with two
   * answers to tell apart. See the module note.
   */
  readonly arc: ArcLabel | null;
  /**
   * Signed downrange miss against the requested R, metres: negative short,
   * positive long. `0` exactly when R was the solved quantity, since then there
   * was nothing to miss.
   *
   * Reported rather than assumed zero, following {@link ArcSolution.downrangeMiss}
   * and `RangeRoot.residual`: a converged bracket is a statement about the
   * bracket's width, and this is the statement about the physics.
   */
  readonly downrangeMiss: number;
  /** The residual evaluation at this aim — the flight this solution describes. */
  readonly residual: ShootingResidual;
  /** Flight time to impact, seconds. */
  readonly timeOfFlight: number;
  /** Root-finder iterations spent on this solution; `0` for the forward solve. */
  readonly iterations: number;
}

/** What {@link designTrajectory} returns. */
export interface DesignResult {
  /** The quantity that was solved for. */
  readonly solveFor: DesignVariable;
  /** The two quantities the request locked, in (θ, v₀, R) order. */
  readonly locked: readonly [DesignVariable, DesignVariable];
  /**
   * Whether the request has any solution at all.
   *
   * False leaves {@link solutions} empty and {@link reason} set. The two ways to
   * get there are physical, not numerical: a target past the envelope at the
   * locked speed, and a target past the range at `speedBounds[1]` at the locked
   * elevation.
   */
  readonly feasible: boolean;
  /**
   * The aims found: two for the θ solve, one for the others, none when
   * infeasible. Ordered low arc first when there are two.
   */
  readonly solutions: readonly DesignSolution[];
  /** Why {@link feasible} is false, in a form a UI can show. `null` when it is true. */
  readonly reason: string | null;
  /**
   * How far past reach the request was, metres; `0` when feasible.
   *
   * For the θ solve this is `ArcPair.shortfall` — distance past the envelope at
   * the locked speed. For the v₀ solve it is the distance past the range at the
   * upper speed bound. Both answer "by how much", which is what a designer UI
   * needs in order to say what to change.
   */
  readonly shortfall: number;
  /** Trajectory integrations spent, every solve included. */
  readonly evaluations: number;
}

const VARIABLES: readonly DesignVariable[] = ["theta", "speed", "range"];

function downrangeAxisOf(layout: TrajectoryLayout): number {
  return layout.position[0]!;
}

/**
 * Solve a designer request.
 *
 * `problem.target` supplies the dynamics' target — the platform or ring whose
 * geometry decides where the terminal event fires — while the *requested* R
 * decides what is being solved for. They are separate on purpose: a designer
 * sweeping R across a raised platform is asking a sequence of questions about
 * the same physical scene, not redefining the scene at each step.
 *
 * @throws if the request does not name exactly two of the three quantities, or
 * if a named quantity is not finite (or not positive, for a speed).
 */
export function designTrajectory(
  problem: ShootingProblem,
  request: DesignRequest,
  options: DesignOptions = {},
): DesignResult {
  const given = VARIABLES.filter((name) => request[name] !== undefined);
  if (given.length !== 2) {
    throw new Error(
      `designTrajectory: lock exactly two of (theta, speed, range) and the third is solved; ` +
        `got ${given.length} (${given.join(", ") || "none"})`,
    );
  }
  for (const name of given) {
    const value = request[name]!;
    if (!Number.isFinite(value)) {
      throw new Error(`designTrajectory: ${name} must be finite; got ${value}`);
    }
    if (name === "speed" && !(value > 0)) {
      throw new Error(`designTrajectory: speed must be positive; got ${value}`);
    }
  }
  const solveFor = VARIABLES.find((name) => request[name] === undefined)!;
  const locked = given as unknown as readonly [DesignVariable, DesignVariable];

  switch (solveFor) {
    case "range":
      return solveForRange(problem, request.theta!, request.speed!, locked);
    case "speed":
      return solveForSpeed(problem, request.theta!, request.range!, locked, options);
    default:
      return solveForTheta(problem, request.speed!, request.range!, locked, options);
  }
}

/**
 * (θ, v₀) locked — R is whatever that shot does.
 *
 * One integration and no root find, which is worth saying out loud because it
 * is easy to reach for the solver out of symmetry with the other two. It also
 * makes this the combination that *defines* R for the other two: they are
 * inverses of this function, and the round-trip test closes that loop.
 */
function solveForRange(
  problem: ShootingProblem,
  theta: number,
  speed: number,
  locked: readonly [DesignVariable, DesignVariable],
): DesignResult {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchDownrange = (problem.launchPoint ?? layout.position.map(() => 0))[axis]!;

  const evaluation = createShootingResidual(problem)({ theta, speed });
  if (!evaluation.ok) {
    // The same call as solveArcs makes, and for the same reason: an aim that
    // never lands has no range, and returning a sentinel would let a designer
    // plot a number for a shot that does not exist.
    throw new Error(
      `designTrajectory: the aim θ = ${theta} rad at v₀ = ${speed} m/s reached no impact ` +
        `(${evaluation.report.failure ?? evaluation.report.status}), so it has no range; ` +
        "widen the problem's tspan",
    );
  }

  return {
    solveFor: "range",
    locked,
    feasible: true,
    solutions: [
      {
        theta,
        speed,
        range: evaluation.impact![axis]! - launchDownrange,
        arc: null,
        downrangeMiss: 0,
        residual: evaluation,
        timeOfFlight: evaluation.timeOfFlight!,
        iterations: 0,
      },
    ],
    reason: null,
    shortfall: 0,
    evaluations: 1,
  };
}

/**
 * (θ, R) locked — solve v₀ by bracketed Brent on `range(v₀) − R`.
 *
 * Monotone in v₀, so the bracket is the whole argument: if the low bound is
 * short and the high bound is long, the answer is between them and Brent will
 * find it. The infeasible case is the high bound still being short, which is a
 * physical statement — "not at this elevation, not at any speed you allowed" —
 * and is reported with the shortfall rather than thrown.
 *
 * The low bound being *long* is the other sign failure, and it cannot happen
 * for a positive R from a ground launch: range falls to zero as v₀ does. It can
 * happen for a **negative** requested R, or from a launch point already past
 * the requested downrange, and that is reported too rather than reaching
 * `brentRoot`, whose "does not bracket a sign change" message would name the
 * symptom instead of the cause.
 */
function solveForSpeed(
  problem: ShootingProblem,
  theta: number,
  targetRange: number,
  locked: readonly [DesignVariable, DesignVariable],
  options: DesignOptions,
): DesignResult {
  const [minSpeed, maxSpeed] = options.speedBounds ?? [1, 400];
  const speedTol = options.speedTol ?? 1e-9;
  const maxIterations = options.maxIterations ?? 100;
  if (!(minSpeed > 0) || !(maxSpeed > minSpeed)) {
    throw new Error(
      `designTrajectory: speedBounds must satisfy 0 < min < max; got [${minSpeed}, ${maxSpeed}]`,
    );
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchDownrange = (problem.launchPoint ?? layout.position.map(() => 0))[axis]!;
  const residual = createShootingResidual(problem);

  let evaluations = 0;
  const evaluateAt = (speed: number): ShootingResidual => {
    evaluations++;
    const evaluation = residual({ theta, speed });
    if (!evaluation.ok) {
      throw new Error(
        `designTrajectory: the aim θ = ${theta} rad at v₀ = ${speed} m/s reached no impact ` +
          `(${evaluation.report.failure ?? evaluation.report.status}), so it has no range to ` +
          "match; widen the problem's tspan or lower speedBounds",
      );
    }
    return evaluation;
  };
  const rangeAt = (speed: number): number => evaluateAt(speed).impact![axis]! - launchDownrange;

  const missLow = rangeAt(minSpeed) - targetRange;
  const missHigh = rangeAt(maxSpeed) - targetRange;

  if (missHigh < 0) {
    return infeasible(
      "speed",
      locked,
      `R = ${targetRange} m is beyond the ${(missHigh + targetRange).toFixed(3)} m this ` +
        `elevation reaches at the ${maxSpeed} m/s speed bound`,
      -missHigh,
      evaluations,
    );
  }
  if (missLow > 0) {
    return infeasible(
      "speed",
      locked,
      `R = ${targetRange} m is shorter than the ${(missLow + targetRange).toFixed(3)} m this ` +
        `elevation already reaches at the ${minSpeed} m/s speed bound`,
      missLow,
      evaluations,
    );
  }

  const root = brentRoot(
    (speed) => rangeAt(speed) - targetRange,
    minSpeed,
    maxSpeed,
    missLow,
    missHigh,
    () => speedTol,
    maxIterations,
  );
  const evaluation = evaluateAt(root.x);

  return {
    solveFor: "speed",
    locked,
    feasible: true,
    solutions: [
      {
        theta,
        speed: root.x,
        range: targetRange,
        arc: null,
        downrangeMiss: evaluation.impact![axis]! - launchDownrange - targetRange,
        residual: evaluation,
        timeOfFlight: evaluation.timeOfFlight!,
        iterations: root.iterations,
      },
    ],
    reason: null,
    shortfall: 0,
    evaluations,
  };
}

/**
 * (v₀, R) locked — solve θ, which is P5.08's two-arc problem.
 *
 * Delegated to `solveArcs` rather than reimplemented. The aim point handed to
 * it is the problem's target centre with the downrange component replaced by
 * `launchDownrange + R`, which is what makes R rather than the target's own
 * downrange the thing being solved for — including when the caller passed an
 * `aimPoint` of their own, since a request that named both would otherwise have
 * two answers to the question of what it was aiming at.
 *
 * The other components are copied rather than zeroed, but nothing downstream
 * reads them: `solveArcs` uses the aim point for its length check and for
 * `aimPoint[downrangeAxis]`, and for nothing else. Copying keeps the value a
 * point of the scene rather than a synthesized one, and a perturbation that
 * zeroed them changed no test — recorded here so the next reader does not
 * mistake it for a load-bearing line.
 *
 * An arc that the angle bounds exclude comes back `null` from `solveArcs` and
 * is simply absent from the list here, which is the same statement in the shape
 * this module returns. `feasible` follows `reachable` — past the envelope — and
 * not "we got two", because one arc is a real answer.
 */
function solveForTheta(
  problem: ShootingProblem,
  speed: number,
  targetRange: number,
  locked: readonly [DesignVariable, DesignVariable],
  options: DesignOptions,
): DesignResult {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const launchDownrange = (problem.launchPoint ?? layout.position.map(() => 0))[axis]!;

  const aimPoint = [...(options.aimPoint ?? problem.target.center)];
  aimPoint[axis] = launchDownrange + targetRange;

  const pair = solveArcs(problem, speed, { ...options, aimPoint });
  const solutions = ([pair.low, pair.high].filter(Boolean) as ArcSolution[]).map(
    (arc): DesignSolution => ({
      theta: arc.aim.theta,
      speed,
      range: targetRange,
      arc: arc.arc,
      downrangeMiss: arc.downrangeMiss,
      residual: arc.residual,
      timeOfFlight: arc.timeOfFlight,
      iterations: arc.iterations,
    }),
  );

  if (!pair.reachable) {
    return infeasible(
      "theta",
      locked,
      `R = ${targetRange} m is ${pair.shortfall.toFixed(3)} m beyond the ` +
        `${pair.maxDownrange.toFixed(3)} m envelope at v₀ = ${speed} m/s`,
      pair.shortfall,
      pair.evaluations,
    );
  }

  return {
    solveFor: "theta",
    locked,
    feasible: true,
    solutions,
    reason: null,
    shortfall: 0,
    evaluations: pair.evaluations,
  };
}

function infeasible(
  solveFor: DesignVariable,
  locked: readonly [DesignVariable, DesignVariable],
  reason: string,
  shortfall: number,
  evaluations: number,
): DesignResult {
  return {
    solveFor,
    locked,
    feasible: false,
    solutions: [],
    reason,
    shortfall,
    evaluations,
  };
}
