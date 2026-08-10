import { brentRoot } from "@ballista/solverkit";
import { type EnvelopeOptions, maxHeightAtDownrange } from "./envelope.js";
import {
  PLANAR_LAYOUT,
  type TrajectoryLayout,
  heightAtDownrange,
  impactPoint,
} from "./observables.js";
import { NO_IMPACT, maximizeRange } from "./optimal-angle.js";
import { type Aim, type ShootingProblem, createFlight } from "./shooting-residual.js";
import { smartInitialAim } from "./smart-init.js";

/**
 * The minimum-energy targeting problem of §7 Phase 5 (P5.15): of all the aims
 * that hit a given point, the one launched slowest.
 *
 * **Why this is a different problem from P5.03/P5.06's shooting solve.** Those
 * solve for an aim that hits, with the speed *given* — two unknowns against a
 * two-component miss, an isolated root. Here the speed is the objective and the
 * elevation is free, so the hit condition is one equation in two unknowns and
 * has a one-parameter family of solutions: for any speed above some threshold
 * there are generally *two* elevations that hit (P5.08's low and high arcs).
 * Minimizing over that family collapses the two arcs together, and the speed at
 * which they merge is the answer. Below it nothing hits; above it, two things
 * do.
 *
 * **That merge is the tangency condition, and it is what makes the answer
 * checkable.** At a fixed speed the arcs sweep out a reachable region whose
 * boundary is P5.09's envelope — the parabola of safety, drag-free. Raising the
 * speed inflates that region monotonically. The least speed that reaches the
 * target is therefore the one whose envelope passes exactly *through* it, and
 * the minimizing arc is the one that touches the boundary there rather than
 * crossing it. So:
 *
 * > **`minimumSpeedToHit` solves `envelopeHeight(x*; v₀) = y*` for `v₀`.**
 *
 * This is the task's KKT-style criterion, and it is a genuine first-order
 * condition rather than a restatement of the objective: the target being *on*
 * the boundary is stationarity, and the two arcs merging into one is the
 * degeneracy that goes with an active constraint. {@link MinEnergySolution.margin}
 * reports the residual of that equation and
 * {@link MinEnergySolution.arcSeparation} reports the merge; `min-energy.test.ts`
 * checks the geometric form of tangency directly, by comparing the optimal arc's
 * slope at the target against the envelope's.
 *
 * **The nesting, and what each level reuses.** The outer level is
 * `@ballista/solverkit`'s `brentRoot` on the launch speed. The inner level is
 * the maximization over elevation that produces the envelope height at the
 * target's abscissa — P5.09's {@link maxHeightAtDownrange}, itself a bracketed
 * 1D search over integrated trajectories. Nothing here re-derives either. That
 * is the "nested Brent/shooting" the task names, and the cost model follows from
 * it: one outer iteration costs a full inner maximization, so a solve is tens of
 * trajectory integrations at best and hundreds in the infeasible branch below.
 *
 * **The drag-free answer is exact and is used as a lower bound, not as a
 * guess.** `smart-init.ts`'s `dragFreeAim` already gives
 * `v₀ = √(g(Δy + R))`, `θ = π/4 + φ/2` in closed form. Drag can only *shrink*
 * the reachable set at a given speed — it removes energy from the projectile
 * and adds none — so the drag-free minimum speed is a rigorous lower bound on
 * the true one for any dissipative force model, and this module brackets
 * upwards from it instead of searching from zero. {@link MinEnergySolution.speedPenalty}
 * reports what drag cost, which is the quantity a caller actually wants.
 *
 * **Standing constraint, stated because this module is adjacent to it.** The
 * drag path is dissipative, so every integration underneath this search is an
 * RK scheme (the problem's own stepper). Nothing here is symplectic and nothing
 * here should be made symplectic; see the blueprint's integrator note.
 */

/** Tuning for {@link minimumSpeedToHit}. Envelope options are forwarded to the inner maximization. */
export interface MinEnergyOptions extends EnvelopeOptions {
  /**
   * Absolute tolerance on the returned speed, m/s. Default `1e-6`.
   *
   * **Do not tighten this below the inner maximization's own noise.** The outer
   * root-find sees `envelopeHeight` through {@link maxHeightAtDownrange}, whose
   * answer carries the error of a bracketed search over an adaptively-integrated
   * trajectory; asking for a speed to `1e-12` when the margin it is rooted on is
   * only good to `1e-8` m spends iterations resolving that noise. `angleTol` and
   * the problem's `rtol`/`atol` are the knobs that actually buy accuracy here.
   */
  readonly speedTol?: number;
  /**
   * Lowest speed considered, m/s. Defaults to the drag-free minimum speed,
   * which is a rigorous lower bound — see the module note.
   *
   * Overriding it *below* the drag-free value is harmless but wasteful.
   * Overriding it *above* risks starting past the answer; that is detected
   * rather than silently returning the bound. The search first contracts
   * downwards looking for a genuine bracket, and only reports
   * `"below-bracket"` if the target is still reachable however far it
   * contracts — see {@link minimumSpeedToHit}.
   */
  readonly minSpeed?: number;
  /**
   * Highest speed considered, m/s. Default `Infinity`, i.e. expansion is
   * limited by {@link maxExpansions} rather than by a speed cap.
   *
   * A finite cap is the way to express a launcher's actual muzzle-velocity
   * limit, and a target that needs more than it is reported `"unreachable"` —
   * a property of the hardware, distinguishable from a failed search.
   */
  readonly maxSpeed?: number;
  /**
   * Factor by which the upper bracket grows per expansion step, `> 1`.
   * Default `1.25`.
   *
   * Speed enters the drag-free reach quadratically (`R = v₀²/g`), so 1.25 in
   * speed is about 1.56 in range — coarse enough to bracket a badly
   * drag-dominated target in a few steps, fine enough that the bracket handed
   * to Brent is not needlessly wide.
   */
  readonly expansionFactor?: number;
  /** Expansion steps before giving up on bracketing. Default `40`. */
  readonly maxExpansions?: number;
  /** Outer root-find iteration backstop. Default `100`. */
  readonly maxIterations?: number;
  /**
   * Gravity for the drag-free lower bound, m/s². Defaults to the magnitude the
   * problem's environment reports at the launch point, via `smartInitialAim`.
   *
   * Only ever affects the *bracket*, never the answer: the search itself is
   * driven by integrated trajectories, which read gravity from the model.
   */
  readonly gravity?: number;
}

/** Why {@link minimumSpeedToHit} stopped. */
export type MinEnergyStatus =
  /** The tangency equation was solved to `speedTol`. */
  | "converged"
  /**
   * No speed up to `maxSpeed` (or within `maxExpansions`) reaches the target.
   * With a finite `maxSpeed` this is a statement about the launcher; without
   * one it means the reachable set stopped growing, which a drag model with a
   * terminal-velocity ceiling can genuinely do.
   */
  | "unreachable"
  /**
   * The target is already reachable at `minSpeed`, so the true minimum lies
   * below the bracket and was not searched for. Only possible when a caller
   * overrode `minSpeed` above the drag-free bound.
   */
  | "below-bracket"
  /** The outer Brent hit `maxIterations`. The best estimate is still returned. */
  | "max-iterations";

/** The minimum-energy aim, and the evidence that it is one. */
export interface MinEnergySolution {
  /** The minimum launch speed that hits the target, m/s. */
  readonly speed: number;
  /**
   * The elevation that hits it at that speed, radians — the tangency aim.
   *
   * **Resolved much less precisely than {@link speed}, inherently.** At the
   * minimum the low and high arcs have merged, so the hit condition is
   * quadratically flat in θ there and no value-comparing search can separate
   * angles finer than roughly `√ε` in relative terms. This is the same
   * degeneracy `optimal-angle.ts` documents for the range peak, arriving for the
   * same reason, and it is benign for the same reason: the arc a degree off is
   * barely worse.
   */
  readonly theta: number;
  /** {@link speed} and {@link theta} as an {@link Aim}, ready to fly. */
  readonly aim: Aim;
  /**
   * Specific kinetic energy at launch, `½v₀²`, in J/kg — the objective actually
   * being minimized, reported so a caller comparing two targets is comparing
   * energies rather than speeds. Multiply by the projectile mass for joules.
   */
  readonly specificEnergy: number;
  /**
   * `envelopeHeight(x*) − y*` at the solution, metres: the residual of the
   * tangency equation, and the number to check before trusting the answer.
   * Zero to the search's tolerance for `"converged"`.
   */
  readonly margin: number;
  /**
   * Half-width in elevation of the merged arc pair at the solution, radians,
   * or `null` when it was not measured.
   *
   * The two arcs that hit a reachable target merge as the speed falls to the
   * minimum, so this tends to zero at the answer — the degeneracy that
   * accompanies the active constraint. Reported as corroboration of tangency
   * from a direction the root-find does not use.
   */
  readonly arcSeparation: number | null;
  /** The final speed bracket, `[lo, hi]`, m/s. Its width is the uncertainty on {@link speed}. */
  readonly bracket: readonly [number, number];
  /** The exact drag-free minimum speed for this geometry, m/s — the lower bound searched from. */
  readonly dragFreeSpeed: number;
  /** The exact drag-free minimum-energy elevation, radians (`π/4 + φ/2`). */
  readonly dragFreeTheta: number;
  /**
   * `speed / dragFreeSpeed − 1`: the fractional speed surcharge drag imposes.
   * Zero for a drag-free problem, positive otherwise, and never negative for a
   * dissipative force model — see the module note.
   */
  readonly speedPenalty: number;
  /** Trajectory integrations spent, the cost that matters. */
  readonly evaluations: number;
  /** Outer root-find iterations. */
  readonly iterations: number;
  /** Why it stopped. */
  readonly status: MinEnergyStatus;
  /** `status === "converged"`. */
  readonly converged: boolean;
}

const DEFAULT_SPEED_TOL = 1e-6;
const DEFAULT_EXPANSION_FACTOR = 1.25;
const DEFAULT_MAX_EXPANSIONS = 40;
const DEFAULT_MAX_ITERATIONS = 100;

/**
 * The layout's downrange axis.
 *
 * A fourth private copy of a helper `arcs.ts`, `envelope.ts` and
 * `smart-init.ts` each already carry. Consolidating the four into
 * `observables.ts` is worth doing and is deliberately *not* done here — it
 * would touch three modules this task has no other business in. Filed as its
 * own backlog item instead.
 */
function downrangeAxisOf(layout: TrajectoryLayout): number {
  for (let axis = 0; axis < layout.position.length; axis++) {
    if (axis !== layout.vertical) return axis;
  }
  throw new Error("minimumSpeedToHit: layout has no horizontal axis");
}

interface Resolved {
  speedTol: number;
  maxSpeed: number;
  expansionFactor: number;
  maxExpansions: number;
  maxIterations: number;
}

function resolve(options: MinEnergyOptions): Resolved {
  const speedTol = options.speedTol ?? DEFAULT_SPEED_TOL;
  const maxSpeed = options.maxSpeed ?? Number.POSITIVE_INFINITY;
  const expansionFactor = options.expansionFactor ?? DEFAULT_EXPANSION_FACTOR;
  const maxExpansions = options.maxExpansions ?? DEFAULT_MAX_EXPANSIONS;

  if (!(speedTol > 0) || !Number.isFinite(speedTol)) {
    throw new Error(`minimumSpeedToHit: speedTol must be finite and positive; got ${speedTol}`);
  }
  if (Number.isNaN(maxSpeed) || maxSpeed <= 0) {
    throw new Error(`minimumSpeedToHit: maxSpeed must be positive; got ${maxSpeed}`);
  }
  if (!Number.isFinite(expansionFactor) || expansionFactor <= 1) {
    throw new Error(
      `minimumSpeedToHit: expansionFactor must be finite and > 1; got ${expansionFactor}`,
    );
  }
  if (!Number.isInteger(maxExpansions) || maxExpansions < 1) {
    throw new Error(
      `minimumSpeedToHit: maxExpansions must be a positive integer; got ${maxExpansions}`,
    );
  }
  return {
    speedTol,
    maxSpeed,
    expansionFactor,
    maxExpansions,
    maxIterations: options.maxIterations ?? DEFAULT_MAX_ITERATIONS,
  };
}

/**
 * The tangency residual `envelopeHeight(x*; v) − y*`, in metres, and the aim
 * that attains it.
 *
 * **Two branches, and the second exists to keep the first from having a hole in
 * it exactly where the answer is.** For an abscissa the arcs can reach,
 * {@link maxHeightAtDownrange} returns the boundary height and the residual is
 * the literal difference. For an abscissa *beyond* the maximum range it returns
 * `null` — no arc gets there at all — and the residual has to be continued in a
 * way that is still negative, still increasing in `v`, and still continuous at
 * the join, or the outer Brent is rooting on a function with a step in it.
 *
 * The continuation used is `−(y* + (x* − R_max(v)))`. At the join, where
 * `x* = R_max(v)`, the first branch's boundary height is zero and it returns
 * `−y*`; so does this one. The two agree there, which is what makes the pair a
 * single continuous function rather than two glued approximations.
 *
 * **This is not a detail — it is the whole ground-target case.** For a target on
 * the deck (`y* = 0`) the minimum-speed answer *is* `R_max(v) = x*`, and the
 * first branch is `null` in a sliver around it: at exactly the maximum range the
 * feasible elevation set collapses to one point, which a finite θ sweep has
 * measure-zero odds of finding, as `envelope.ts` documents. The root the outer
 * search converges to for a ground target is therefore found on this branch, and
 * it reduces there to `R_max(v) − x*`, which is exactly right.
 */
function tangencyMargin(
  problem: ShootingProblem,
  targetX: number,
  targetY: number,
  speed: number,
  options: EnvelopeOptions,
  spend: (n: number) => void,
): { margin: number; theta: number | null } {
  const above = maxHeightAtDownrange(problem, speed, targetX, options);
  if (above !== null) {
    spend(above.evaluations);
    return { margin: above.height - targetY, theta: above.theta };
  }

  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const fly = createFlight(problem);
  let flights = 0;
  const rangeAt = (theta: number): number => {
    flights++;
    const flight = fly({ theta, speed });
    if (!flight.ok || flight.trajectory === null) return NO_IMPACT;
    return impactPoint(flight.trajectory, layout)[axis]!;
  };

  const reach = maximizeRange(rangeAt, options);
  spend(flights);
  if (!Number.isFinite(reach.range)) {
    // Nothing lands at all at this speed. Still negative, still increasing in
    // v: report the whole slant displacement as the shortfall.
    return { margin: -(Math.abs(targetY) + Math.abs(targetX)), theta: null };
  }
  return { margin: -(targetY + (targetX - reach.range)), theta: reach.theta };
}

/**
 * Half-width in elevation of the arc pair that hits the target at `speed`,
 * measured as the span of elevations whose arcs clear the target height at its
 * abscissa.
 *
 * Corroboration only, and cheap: it reuses the elevation sweep's own resolution
 * rather than solving for the two arc angles (that is P5.08's job). Returns
 * `null` when the target is not cleared at all at this speed.
 */
function measureArcSeparation(
  problem: ShootingProblem,
  targetX: number,
  targetY: number,
  speed: number,
  peakTheta: number,
  options: EnvelopeOptions,
  spend: (n: number) => void,
): number | null {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  const fly = createFlight(problem);
  let flights = 0;
  /**
   * Height the arc has as it passes the target abscissa, interpolated —
   * `heightAtDownrange`, the same observable the envelope itself is built on,
   * rather than the nearest recorded row. At tangency the arc grazes the target
   * and the two differ by more than the thing being measured.
   */
  const clearance = (theta: number): number | null => {
    flights++;
    const flight = fly({ theta, speed });
    if (!flight.ok || flight.trajectory === null) return null;
    const height = heightAtDownrange(flight.trajectory, targetX, layout);
    return height === null ? null : height - targetY;
  };

  const atPeak = clearance(peakTheta);
  if (atPeak === null) {
    spend(flights);
    return null;
  }
  // Widen from the peak until neither side clears. The step sets the resolution
  // and therefore the floor on what this can report: a separation genuinely
  // narrower than one step reads as zero, which is the honest answer at a
  // tangency and the reason this is corroboration and not a convergence test.
  const step = 1e-3;
  let width = 0;
  for (let i = 1; i <= 64; i++) {
    const delta = i * step;
    const up = clearance(peakTheta + delta);
    const down = clearance(peakTheta - delta);
    if ((up === null || up < 0) && (down === null || down < 0)) break;
    width = delta;
  }
  spend(flights);
  return width;
}

/**
 * Solves the minimum-energy targeting problem: the least launch speed that puts
 * some arc through `target`, and the elevation that does it.
 *
 * The search is a root-find on {@link tangencyMargin} over speed, bracketed from
 * the drag-free minimum upwards — see the module note for why that bound is
 * rigorous and why the root is the tangency point.
 *
 * @param problem Supplies the dynamics, launch point and solver settings. Its
 *   own `target` is used only for the drag-free bracket when `target` here
 *   coincides with it; the point asked about is the `target` argument.
 * @param target `[downrange, height]` in the layout's coordinates, absolute
 *   rather than relative to the launch point — the same convention
 *   `assessReachability` takes, and like it this entry point is written for a
 *   planar layout.
 */
export function minimumSpeedToHit(
  problem: ShootingProblem,
  target: readonly [number, number],
  options: MinEnergyOptions = {},
): MinEnergySolution {
  const [targetX, targetY] = target;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    throw new Error(`minimumSpeedToHit: target must be finite; got [${targetX}, ${targetY}]`);
  }
  const r = resolve(options);

  const dragFree = smartInitialAim(problem, {
    aimPoint: [targetX, targetY],
    ...(options.gravity === undefined ? {} : { gravity: options.gravity }),
  });
  const dragFreeSpeed = dragFree.speed;
  const dragFreeTheta = dragFree.theta;

  let evaluations = 0;
  const spend = (n: number): void => {
    evaluations += n;
  };
  const marginAt = (speed: number): { margin: number; theta: number | null } =>
    tangencyMargin(problem, targetX, targetY, speed, options, spend);

  const lo = options.minSpeed ?? dragFreeSpeed;
  if (!(lo > 0) || !Number.isFinite(lo)) {
    throw new Error(`minimumSpeedToHit: minSpeed must be finite and positive; got ${lo}`);
  }

  const finish = (
    speed: number,
    theta: number,
    margin: number,
    bracket: readonly [number, number],
    iterations: number,
    status: MinEnergyStatus,
    arcSeparation: number | null,
  ): MinEnergySolution => ({
    speed,
    theta,
    aim: { theta, speed },
    specificEnergy: 0.5 * speed * speed,
    margin,
    arcSeparation,
    bracket,
    dragFreeSpeed,
    dragFreeTheta,
    speedPenalty: speed / dragFreeSpeed - 1,
    evaluations,
    iterations,
    status,
    converged: status === "converged",
  });

  let low = lo;
  let atLow = marginAt(low);
  let high = lo;
  let atHigh = atLow;
  let bracketed = false;

  if (atLow.margin >= 0) {
    // **Already reachable at the lower bound, which is the drag-free case, not
    // an error.** For a dissipative model the drag-free speed is a strict lower
    // bound and this branch is unreachable; for a drag-*free* problem it is the
    // exact answer, so the margin there is zero to rounding and the test above
    // sees `>= 0`. Reporting "the minimum is below the bracket" would be
    // precisely wrong in the case the module is most confident about.
    //
    // Contracting downwards settles it without needing a magnitude threshold on
    // a metres-valued margin whose natural scale this module does not know: if
    // a slightly slower launch cannot reach, the bound *is* the minimum and the
    // root-find below re-derives it from a genuine bracket. If a slower launch
    // still reaches, the minimum really is lower and the caller raised
    // `minSpeed` past it.
    high = low;
    atHigh = atLow;
    for (let i = 0; i < r.maxExpansions; i++) {
      const next = low / r.expansionFactor;
      if (!(next > 0) || !Number.isFinite(next)) break;
      low = next;
      atLow = marginAt(low);
      if (atLow.margin < 0) {
        bracketed = true;
        break;
      }
    }
    if (!bracketed) {
      return finish(
        high,
        atHigh.theta ?? dragFreeTheta,
        atHigh.margin,
        [low, high],
        0,
        "below-bracket",
        null,
      );
    }
  } else {
    // Expand upwards for a speed that reaches.
    for (let i = 0; i < r.maxExpansions; i++) {
      const next = Math.min(high * r.expansionFactor, r.maxSpeed);
      if (!(next > high)) break; // hit the cap
      high = next;
      atHigh = marginAt(high);
      if (atHigh.margin >= 0) {
        bracketed = true;
        break;
      }
    }
    if (!bracketed) {
      return finish(
        high,
        atHigh.theta ?? dragFreeTheta,
        atHigh.margin,
        [low, high],
        0,
        "unreachable",
        null,
      );
    }
  }

  let bracketLo = low;
  let bracketHi = high;
  const root = brentRoot(
    (speed) => {
      const m = marginAt(speed).margin;
      if (m < 0) bracketLo = Math.max(bracketLo, speed);
      else bracketHi = Math.min(bracketHi, speed);
      return m;
    },
    low,
    high,
    atLow.margin,
    atHigh.margin,
    () => r.speedTol,
    r.maxIterations,
  );

  // Report the speed on the *feasible* side of the bracket. A root estimate
  // that lands a hair below the true minimum is a speed that does not actually
  // hit, and handing a caller an aim that misses is a worse failure than
  // handing them one `speedTol` too fast.
  const speed = root.fx >= 0 ? root.x : bracketHi;
  const final = marginAt(speed);
  const theta = final.theta ?? dragFreeTheta;
  const separation = measureArcSeparation(problem, targetX, targetY, speed, theta, options, spend);

  return finish(
    speed,
    theta,
    final.margin,
    [bracketLo, bracketHi],
    root.iterations,
    root.converged ? "converged" : "max-iterations",
    separation,
  );
}
