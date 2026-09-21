import type { EvalContext, Model } from "@ballista/engine";
import {
  type SolveReport,
  type SolverConfig,
  type Stepper,
  type Trajectory,
  TrajectoryRecorder,
  integrate,
} from "@ballista/solverkit";
import {
  PLANAR_LAYOUT,
  type TrajectoryLayout,
  downrangeAxisOf,
  impactPoint,
  timeOfFlight,
} from "./observables.js";
import { type Target, missVector, validateTarget } from "./targets.js";

/**
 * The shooting residual of §7 Phase 5 (P5.04): the vector-valued function
 * whose root is a hit.
 *
 * $$F(\theta, v_0) = \mathbf r_{\text{impact}}(\theta, v_0) - \mathbf r^*$$
 *
 * Everything downstream in Phase 5 consumes this one function. P5.05
 * differentiates it, P5.06 drives it to zero with Newton, P5.07 supplies the
 * initial guess, P5.26 falls back to Levenberg–Marquardt when Newton stalls.
 * So the property that matters here is not accuracy — a residual is exact by
 * construction, it is whatever the trajectory did — but **smoothness in the
 * aim**. A residual with a jump discontinuity in `(θ, v₀)` has no usable
 * derivative at the jump, and every one of those solvers is built on the
 * assumption that it does.
 *
 * **Where the discontinuity would come from, and why it does not.** The
 * impact point is not an integration output at a time the caller chose; it is
 * the state at whatever time the ground event fires, and that time moves
 * continuously as the aim moves while the *step grid does not*. A residual
 * that read the last recorded step — the last multiple of `h` before the
 * crossing — would therefore be a staircase in `θ`: constant while the
 * crossing slides through a step, then jumping by roughly one step's worth of
 * travel (`h · v_impact`, metres, not microns) each time it crosses a step
 * boundary. What removes that staircase is `integrate`'s terminal-event
 * handling (§4.9, P2.32–P2.35): the step containing the crossing is truncated
 * at the root, localized through the stepper's **dense-output interpolant**,
 * and the localized state is what reaches the recorder's final row. The
 * impact point is thus a smooth function of the aim regardless of where the
 * step boundaries happen to fall — which is exactly what P5.04's validation
 * criterion measures, and why {@link createShootingResidual} insists on a
 * stepper that has an interpolant rather than accepting any stepper and
 * silently returning the staircase.
 */

/**
 * The aim: the two control variables a 2D shooting problem solves for.
 *
 * Kept as a named pair rather than a bare `[theta, v0]` tuple because the
 * residual is *also* a 2-vector, in a different space (metres, not
 * radians-and-metres-per-second), and P5.05's Jacobian has one of each on its
 * two axes. Two indistinguishable `number[]`s either side of a finite
 * difference is a transposition waiting to happen.
 */
export interface Aim {
  /** Elevation angle, radians, measured from the horizontal. */
  readonly theta: number;
  /** Launch speed, metres per second. */
  readonly speed: number;
}

/** A shooting problem: everything except the aim, which is what gets varied. */
export interface ShootingProblem {
  /** The dynamics. Must declare a terminal event; see {@link createShootingResidual}. */
  readonly model: Model;
  /** Environment and projectile parameters the model reads. */
  readonly ctx: EvalContext;
  /** The target whose miss vector is the residual. */
  readonly target: Target;
  /**
   * Launch position, in the layout's axis order and length. Defaults to the
   * origin.
   *
   * A raised launch is the case that makes P5.03's closed form inapplicable
   * and the integrated residual necessary, so it is a first-class parameter
   * here rather than something a caller patches into `y0` afterwards.
   */
  readonly launchPoint?: readonly number[];
  /**
   * Integration span. The upper bound is a *backstop*, not the stopping
   * condition — a well-posed shot ends on its terminal event well before it.
   * Defaults to `[0, 600]`.
   */
  readonly tspan?: readonly [number, number];
  /** Solver configuration handed to `integrate`. */
  readonly config: SolverConfig;
  /** The stepper. Must expose an `interpolant`; see {@link createShootingResidual}. */
  readonly stepper: Stepper;
  /** Channel layout of the model's state. Defaults to {@link PLANAR_LAYOUT}. */
  readonly layout?: TrajectoryLayout;
}

/**
 * One evaluation of the residual.
 *
 * `residual` is the whole point; the rest is what a solver needs in order to
 * decide what to do with it, and is reported rather than recomputed because
 * every field is already in hand at the moment the residual is formed.
 */
export interface ShootingResidual {
  /**
   * $\mathbf r_{\text{impact}} - \mathbf r^*$, in metres, one component per
   * layout position axis. `null` when {@link ok} is false.
   *
   * For a {@link PointTarget} this is the literal difference of the two
   * points. For a ring or a platform it is the miss against the *nearest*
   * point of the target, which is zero across the target's whole face — the
   * right residual for "put it anywhere on the pad", and a deliberately
   * degenerate one for Newton, which needs an isolated root. P5.06 should
   * shoot at a point target and use the extended shapes for scoring.
   */
  readonly residual: number[] | null;
  /** The event-localized impact point, metres. `null` when {@link ok} is false. */
  readonly impact: number[] | null;
  /** Flight time to impact, seconds. `null` when {@link ok} is false. */
  readonly timeOfFlight: number | null;
  /**
   * Whether the solve reached a terminal event and the residual is meaningful.
   *
   * False is a *reportable outcome*, not an exception: a Newton line search
   * (P5.06) that steps into an aim which runs out of `tspan` or step budget
   * needs to shorten its step, and it can only do that if the failure comes
   * back as a value. Throwing would make an ordinary incident in an
   * optimization — a bad trial point — indistinguishable from a bug.
   *
   * **This is not `report.status === "ok"`, and the difference is the whole
   * hazard.** Exhausting `tspan` without ever hitting the ground is a
   * perfectly *successful* solve — the driver reached `t_f`, so the status is
   * `"ok"` — and its final recorded row is an ordinary mid-air point that
   * `impactPoint` will report as an impact without complaint. A shot that
   * flies off the end of its time budget would come back with a residual that
   * is finite, plausible, and meaningless. See {@link createShootingResidual}
   * for how the two are told apart.
   */
  readonly ok: boolean;
  /** The full solve report, including `failure` when the solve did not finish. */
  readonly report: SolveReport;
  /** The aim this residual was evaluated at, echoed back for traceability. */
  readonly aim: Aim;
}

/**
 * A proof that no aim can hit the target through this problem's terminal
 * event (P0.105).
 *
 * Attached to a {@link ResidualFunction} by {@link createShootingResidual}
 * when, and only when, it can *prove* the negative — see
 * {@link createShootingResidual} for the three conditions. A solver that
 * finds this present can say why it is not going to converge instead of
 * discovering it as a stall.
 */
export interface UnreachableTarget {
  /** Name of the terminal event whose surface the target sits off. */
  readonly event: string;
  /**
   * `g` evaluated on the target's plane, i.e. the signed distance from the
   * target to the event surface in the event's own units. Positive means the
   * target is on the side the projectile approaches from.
   */
  readonly offset: number;
  /** One sentence naming the cause, suitable for a solver's `failure` field. */
  readonly reason: string;
}

/**
 * A residual function of the aim, with the problem closed over.
 *
 * Declared as a call signature with an optional property rather than a bare
 * function type so that {@link createShootingResidual} can hand solvers the
 * {@link unreachableTarget} proof without a second argument threaded through
 * every call site. A plain arrow function still satisfies it, which is what
 * keeps `shootingJacobian` and the test suite's hand-rolled residuals valid.
 */
export interface ResidualFunction {
  (aim: Aim): ShootingResidual;
  /**
   * Present only when the target is *provably* unreachable through the
   * problem's terminal event. Absent means "not proven", never "reachable".
   */
  readonly unreachableTarget?: UnreachableTarget;
}

/**
 * One flown aim, before anything is read off it.
 *
 * Factored out for P5.09, which needs the *path* rather than the endpoint: the
 * reachability boundary is the highest an arc gets at a chosen abscissa, and a
 * {@link ShootingResidual} has already discarded everything but the impact row
 * by the time it is returned. Rebuilding the integration in that module instead
 * would have duplicated {@link ShootingProblem}'s launch-state convention — the
 * axis $v_0\cos\theta$ goes into — in a second place, and a disagreement
 * between the two copies would surface as an envelope that quietly disagrees
 * with the solver it is supposed to bound.
 */
export interface Flight {
  /** The recorded path, or `null` when the solve did not reach a terminal event. */
  readonly trajectory: Trajectory | null;
  /** Whether the solve ended on its terminal event. Same discriminator as {@link ShootingResidual.ok}. */
  readonly ok: boolean;
  /** The full solve report. */
  readonly report: SolveReport;
  /** The aim flown, echoed back. */
  readonly aim: Aim;
}

/** A flight function of the aim, with the problem closed over. */
export type FlightFunction = (aim: Aim) => Flight;

const DEFAULT_TSPAN: readonly [number, number] = [0, 600];

/**
 * Builds the launch state `y0` for an aim.
 *
 * The velocity is placed in the layout's *vertical* and first *horizontal*
 * axis: `v₀cos θ` downrange, `v₀ sin θ` up, and zero on any remaining axis. A
 * spatial (3D) layout therefore launches in the `x`–`y` plane, which is what a
 * 2D aim can express; azimuth is a third control variable and belongs to
 * whatever task introduces it, not to this one.
 */
function launchState(problem: ShootingProblem, aim: Aim, layout: TrajectoryLayout): Float64Array {
  const dim = problem.model.dim;
  const y0 = new Float64Array(dim);
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  if (launchPoint.length !== layout.position.length) {
    throw new Error(
      `createShootingResidual: launchPoint has ${launchPoint.length} component(s), ` +
        `but the layout has ${layout.position.length} position axis/axes`,
    );
  }

  for (let axis = 0; axis < layout.position.length; axis++) {
    const value = launchPoint[axis]!;
    if (!Number.isFinite(value)) {
      throw new Error(`createShootingResidual: launchPoint[${axis}] must be finite; got ${value}`);
    }
    y0[layout.position[axis]!] = value;
  }

  // The first axis that is not the vertical one is "downrange".
  const downrange = downrangeAxisOf(layout);
  y0[layout.velocity[downrange]!] = aim.speed * Math.cos(aim.theta);
  y0[layout.velocity[layout.vertical]!] = aim.speed * Math.sin(aim.theta);
  return y0;
}

/**
 * Closes a {@link ShootingProblem} over its fixed parts and returns the
 * residual as a function of the aim alone.
 *
 * Built once and reused across every evaluation, because a Newton solve is
 * dozens of integrations and each finite-difference Jacobian column (P5.05) is
 * two more. Nothing here is per-aim except `y0` and the recorder.
 *
 * **Two preconditions are checked eagerly, and both are about the validation
 * criterion rather than about defensive programming.** `integrate` truncates a
 * step at a terminal event only when the model declares one *and* the stepper
 * exposes an interpolant; with either missing it integrates to `tspan[1]` or
 * the step budget and the recorder's final row is an ordinary grid point. The
 * residual formed from that row is the staircase this module exists to avoid,
 * and — this is the part worth guarding — it *looks* fine. It is finite, it
 * has the right order of magnitude, it decreases as the aim improves. Only its
 * derivative is wrong. A caller who pairs this with `createClassicalRk4Stepper`
 * gets a silently non-differentiable residual and discovers it as a Newton
 * solver that converges linearly, several tasks downstream. Failing at
 * construction is the difference between a five-second error and that.
 */
/**
 * Points on the target's own plane, spanning its horizontal footprint.
 *
 * Every target shape here is flat, so "the target" is a set of positions at
 * one height; these are the positions an impact would have to reach to score
 * a hit. The centre is always included, and each shape contributes its
 * extremes: the two ends of every horizontal axis for a ring, and every
 * corner for a platform. Sampling the *extremes* rather than an interior grid
 * is deliberate — {@link proveTargetUnreachable} accepts a verdict only when
 * every sample agrees exactly, so a sample set that reaches the boundary is
 * strictly harder to satisfy than one that does not.
 */
function footprintSamples(target: Target, layout: TrajectoryLayout): number[][] {
  const centre = layout.position.map((_, axis) => target.center[axis]!);
  const samples: number[][] = [centre];
  const horizontalAxes = layout.position
    .map((_, axis) => axis)
    .filter((axis) => axis !== layout.vertical);

  const offsetAlong = (axis: number, delta: number): void => {
    const point = [...centre];
    point[axis] = centre[axis]! + delta;
    samples.push(point);
  };

  if (target.kind === "ring") {
    for (const axis of horizontalAxes) {
      offsetAlong(axis, target.radius);
      offsetAlong(axis, -target.radius);
      const inner = target.innerRadius ?? 0;
      if (inner > 0) {
        offsetAlong(axis, inner);
        offsetAlong(axis, -inner);
      }
    }
  } else if (target.kind === "platform") {
    // Corners, as the product of ± each half-extent, plus the single-axis
    // extremes the product already contains for a 1-D footprint.
    let corners: number[][] = [centre];
    horizontalAxes.forEach((axis, index) => {
      const half = target.halfExtents[index]!;
      corners = corners.flatMap((point) => {
        const low = [...point];
        const high = [...point];
        low[axis] = centre[axis]! - half;
        high[axis] = centre[axis]! + half;
        return half === 0 ? [point] : [low, high];
      });
    });
    samples.push(...corners);
  }
  return samples;
}

/** Probe velocities used to establish that an event's `g` ignores velocity. */
const PROBE_VELOCITIES: readonly number[] = [0, 1, -1, 100];
/** Probe times used to establish that an event's `g` ignores `t`. */
const PROBE_TIMES: readonly number[] = [0, 1, 1000];

/**
 * `g` evaluated at one footprint point, or `null` if it is not a single
 * well-defined number there — because it varies with velocity, varies with
 * `t`, is not finite, or threw.
 */
function eventValueAt(
  event: { readonly name: string; g(t: number, y: Float64Array): number },
  point: readonly number[],
  dim: number,
  layout: TrajectoryLayout,
): number | null {
  let value: number | null = null;
  for (const speed of PROBE_VELOCITIES) {
    const y = new Float64Array(dim);
    for (let axis = 0; axis < layout.position.length; axis++) {
      y[layout.position[axis]!] = point[axis]!;
      y[layout.velocity[axis]!] = speed;
    }
    for (const t of PROBE_TIMES) {
      let probed: number;
      try {
        probed = event.g(t, y);
      } catch {
        // An event that will not evaluate on a synthetic state tells us
        // nothing, which is a declined verdict rather than a failure.
        return null;
      }
      if (!Number.isFinite(probed)) return null;
      if (value === null) value = probed;
      else if (probed !== value) return null;
    }
  }
  return value;
}

/**
 * Proves, or declines to prove, that no aim can hit `problem.target`.
 *
 * **The asymmetry is the whole of the correctness argument: this can prove
 * unreachability and can never conclude reachability.** An impact lies on a
 * terminal event's surface by construction — that is what `createFlight`'s
 * `endedOnEvent` discriminator guarantees — and every target shape is flat,
 * so a hit requires an impact whose position lies on the target's plane. If
 * some terminal event's `g` is non-zero everywhere on that plane's footprint,
 * no impact can be there.
 *
 * Three conditions must all hold, and each rules out a way a finite probe
 * could be misread:
 *
 * 1. `g` does not vary with velocity, so a probe at one velocity speaks for
 *    an impact arriving at any other;
 * 2. `g` does not vary with `t`, so the surface is not moving;
 * 3. `g` is **exactly equal** at every footprint sample and non-zero, so the
 *    surface is flat across the footprint — which is what makes a handful of
 *    samples a statement about the whole of it rather than an extrapolation
 *    between them.
 *
 * Anything else returns `undefined` and every downstream path behaves exactly
 * as it did before this function existed. That direction matters more than
 * coverage: a false "unreachable" would turn a solvable problem into a
 * reported failure, whereas a declined verdict costs only the stall that was
 * already there. Sloped or wiggly terrain under the footprint is therefore
 * *not* handled, on purpose — condition 3 fails and the verdict is declined.
 */
function proveTargetUnreachable(
  problem: ShootingProblem,
  layout: TrajectoryLayout,
): UnreachableTarget | undefined {
  const terminalEvents = (problem.model.events ?? []).filter((event) => event.terminal);
  if (terminalEvents.length === 0) return undefined;

  const samples = footprintSamples(problem.target, layout);
  const verdicts: UnreachableTarget[] = [];

  // EVERY terminal event must be ruled out. Reaching any one of them ends the
  // solve and produces an impact, so a single event whose surface the target
  // might lie on is enough to make the target potentially hittable.
  for (const event of terminalEvents) {
    let offset: number | null = null;
    for (const point of samples) {
      const value = eventValueAt(event, point, problem.model.dim, layout);
      // A zero means the target's plane touches this event's surface here, so
      // an impact could be on it; a null means the probe learned nothing. Both
      // decline the verdict for the whole problem.
      if (value === null || value === 0) return undefined;
      if (offset === null) offset = value;
      // Unequal samples mean the surface is not flat across the footprint, so
      // these samples say nothing about the points between them.
      else if (value !== offset) return undefined;
    }
    if (offset === null) return undefined;
    verdicts.push({
      event: event.name,
      offset,
      reason:
        `the target's plane lies off the "${event.name}" terminal event surface by ` +
        `${offset} in the event's own units, and every impact is on that surface by ` +
        "construction, so no aim can reduce the miss below that offset",
    });
  }
  return verdicts[0];
}

export function createShootingResidual(problem: ShootingProblem): ResidualFunction {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  validateTarget(problem.target, layout);
  const fly = createFlight(problem);

  const evaluateResidual = (aim: Aim): ShootingResidual => {
    const flight = fly(aim);
    if (!flight.ok || flight.trajectory === null) {
      return {
        residual: null,
        impact: null,
        timeOfFlight: null,
        ok: false,
        report: flight.report,
        aim,
      };
    }

    const impact = impactPoint(flight.trajectory, layout);
    return {
      residual: missVector(problem.target, impact, layout),
      impact,
      timeOfFlight: timeOfFlight(flight.trajectory),
      ok: true,
      report: flight.report,
      aim,
    };
  };

  // Computed once at construction, not per evaluation: it depends only on the
  // model and the target, both of which are closed over here.
  const unreachableTarget = proveTargetUnreachable(problem, layout);
  if (unreachableTarget === undefined) return evaluateResidual;
  return Object.assign(evaluateResidual, { unreachableTarget });
}

/**
 * Closes a {@link ShootingProblem} over its fixed parts and returns the flown
 * trajectory as a function of the aim alone.
 *
 * The integration half of {@link createShootingResidual}, which is written in
 * terms of this. Both preconditions and the terminal-event discriminator
 * documented there apply here unchanged and are enforced here — that is the
 * point of the factoring, so a second caller cannot get a staircase residual by
 * reaching past the checks.
 *
 * The target is *not* validated here: a caller reading the path rather than the
 * miss (P5.09's envelope sweeps abscissae, and has no target until it asks
 * about one) has no use for it. {@link createShootingResidual} validates it
 * before delegating.
 */
export function createFlight(problem: ShootingProblem): FlightFunction {
  const layout = problem.layout ?? PLANAR_LAYOUT;

  const terminalEvents = (problem.model.events ?? []).filter((event) => event.terminal);
  if (terminalEvents.length === 0) {
    throw new Error(
      "createFlight: the model declares no terminal event, so no solve can produce " +
        "an impact — the residual would be read off whatever row `tspan` or `maxSteps` " +
        "happened to end on",
    );
  }
  if (problem.stepper.interpolant === undefined) {
    throw new Error(
      `createFlight: stepper "${problem.stepper.info.id}" exposes no dense-output ` +
        "interpolant, so `integrate` cannot truncate a step at the event root. The impact " +
        "would be the last step grid point before the crossing, making the residual " +
        "discontinuous in the aim (P5.04's validation criterion is exactly that it is not)",
    );
  }

  const tspan = problem.tspan ?? DEFAULT_TSPAN;

  return (aim: Aim): Flight => {
    if (!Number.isFinite(aim.theta) || !Number.isFinite(aim.speed)) {
      throw new Error(`createFlight: aim must be finite; got θ = ${aim.theta}, v₀ = ${aim.speed}`);
    }

    const y0 = launchState(problem, aim, layout);
    const recorder = new TrajectoryRecorder();
    const report = integrate(
      problem.model,
      problem.ctx,
      y0,
      tspan,
      problem.config,
      problem.stepper,
      [recorder],
    );

    // A terminal event ends the solve *early*, so `tFinal` sits strictly
    // inside the span; the driver clamps its last step to land exactly on
    // `tspan[1]` when the span is what ran out, which makes this an exact
    // discriminator rather than a tolerance. Testing `report.status` alone
    // would accept an exhausted span as an impact (see `ShootingResidual.ok`).
    // The remaining case — an event firing exactly at `tspan[1]` — is reported
    // as "no impact", the conservative direction: a caller told there is no
    // residual widens its span, whereas one handed a mid-air point does not.
    const endedOnEvent = report.tFinal < tspan[1];
    if (report.status !== "ok" || !endedOnEvent || recorder.trajectory.nSteps < 1) {
      return { trajectory: null, ok: false, report, aim };
    }
    return { trajectory: recorder.trajectory, ok: true, report, aim };
  };
}

/**
 * Euclidean norm of a residual — the scalar merit function `‖F‖` that P5.06's
 * Armijo line search decreases and P5.19 plots against iteration count.
 *
 * `Infinity` for a failed evaluation, so that a line search comparing merit
 * values treats an aim whose solve did not finish as worse than any aim whose
 * did, without a null check at every comparison site.
 */
export function residualNorm(evaluation: ShootingResidual): number {
  if (!evaluation.ok || evaluation.residual === null) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const component of evaluation.residual) sum += component * component;
  return Math.sqrt(sum);
}
