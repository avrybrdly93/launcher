import { PLANAR_LAYOUT, downrangeAxisOf, heightAtDownrange } from "./observables.js";
import { type Aim, type Flight, type ShootingProblem, createFlight } from "./shooting-residual.js";

/**
 * The reachability boundary of §7 Phase 5 (P5.09): with drag, the analog of the
 * **parabola of safety**.
 *
 * At a fixed launch speed the arcs sweep out a region of the plane, and its
 * boundary is the classical envelope — the curve every trajectory touches and
 * none crosses. Drag-free and from the origin it is exactly
 *
 * $$y_{\max}(x) = \frac{v_0^2}{2g} - \frac{g x^2}{2 v_0^2},$$
 *
 * a downward parabola meeting the ground at the maximum range $v_0^2/g$. With
 * drag there is no closed form, so it is **measured**: for each abscissa, the
 * highest any arc gets there.
 *
 * **What this owns that P5.08 does not.** `arcs.ts` already reports
 * `maxDownrange` and a `shortfall`, and that is a complete answer for a target
 * *on the ground* — one number along one line. It says nothing about a target
 * in the air, which is unreachable whenever it sits above the envelope even at
 * an abscissa well inside the maximum range. The question "can this shot be
 * made, and if not by how much is it missed" is two-dimensional, and this
 * module is where it is answered. Read the other way: P5.08's `shortfall` is
 * this module's distance-to-envelope restricted to $y^* = 0$.
 *
 * **The maximization is over elevation at a fixed abscissa, which is the step
 * that needs the new observable.** For a chosen $x$, each aim contributes the
 * one height its arc has as it passes — `heightAtDownrange`, interpolated
 * rather than read off a step boundary — and $y_{\max}(x)$ is the largest of
 * those over $\theta$. Drag-free this has a closed form of its own, the
 * maximizing elevation being $\tan\theta = v_0^2/(gx)$, and `envelope.test.ts`
 * checks the measured angle against it; the point of measuring is that the
 * relation stops holding the moment drag or a raised launch enters.
 *
 * **Why an aim that falls short is not an error here.** Sweeping $\theta$ at a
 * fixed abscissa necessarily probes aims whose arcs land before reaching it —
 * every elevation outside the two P5.08 would solve for does. Those contribute
 * "no height at all" rather than a small one, so they are scored as $-\infty$
 * and lose every comparison. That is what makes the sweep's feasible set an
 * interval without having to solve for its endpoints first. `solveArcs` throws
 * on a non-impacting aim for a different and still correct reason: there a
 * missing range breaks the bracketing it is about to do, whereas here it is an
 * ordinary answer.
 *
 * **Both ends of the curve are degenerate, in opposite ways, and neither is
 * papered over.**
 *
 * At the **launch abscissa** the boundary is attained by the vertical shot,
 * whose path is a vertical *segment* rather than a graph over $x$: "the height
 * where the arc passes this abscissa" has no single answer there, and
 * `heightAtDownrange`'s first-crossing rule truthfully reports the launch point
 * itself. The limit from the right is the vertical shot's apex $v_0^2/2g$, and
 * that is what the curve tends to, so {@link computeEnvelope} samples strictly
 * to the right of the launch point rather than reporting a launch-height
 * "boundary" that would make the curve appear to rise.
 *
 * At the **ground endpoint** the opposite happens: $x = R_{\max}$ is reached by
 * exactly one elevation, so the feasible set of $\theta$ collapses to a single
 * point and a finite sweep has measure-zero odds of landing in it —
 * {@link maxHeightAtDownrange} returns `null` at and just inside the maximum
 * range, and its accuracy degrades over the last sliver before it. That
 * endpoint needs no sweep: it is $(R_{\max}, 0)$ by construction, since the
 * max-range arc arrives there by landing. Both entry points use it directly,
 * which is what lets a target beyond the maximum range have its distance
 * measured to the true end of the curve instead of to the last abscissa a sweep
 * happened to resolve.
 */

/** Tuning shared by the envelope entry points. */
export interface EnvelopeOptions {
  /** Lowest elevation considered, radians. Default `0`. */
  readonly minAngle?: number;
  /** Highest elevation considered, radians. Default `π/2`. */
  readonly maxAngle?: number;
  /**
   * Coarse elevation samples used to bracket the height-maximizing aim at each
   * abscissa. Default `16`.
   *
   * A bracketing count rather than an accuracy knob, exactly as
   * `arcs.ts`'s `locatePeakAngle` `sweepSamples` is: the refinement that follows
   * sets the precision, and this only has to be fine enough that no sample step
   * skips the maximum.
   */
  readonly sweepSamples?: number;
  /** Absolute tolerance on the maximizing elevation, radians. Default `1e-7`. */
  readonly angleTol?: number;
  /**
   * Backstop on golden-section iterations per maximization. Default `200`.
   *
   * Reached only if `angleTol` is set below what the bracket can contract to in
   * double precision, which would otherwise spin.
   */
  readonly maxIterations?: number;
}

/** The envelope's height above one abscissa, and the aim that achieves it. */
export interface EnvelopeHeight {
  /** The abscissa asked about, in the layout's downrange coordinate. */
  readonly downrange: number;
  /** The greatest height any arc reaches there, same units and datum as the launch point. */
  readonly height: number;
  /** The elevation achieving it, radians. */
  readonly theta: number;
  /** Trajectory integrations spent. */
  readonly evaluations: number;
}

/** A sampled point of the boundary curve. */
export interface EnvelopePoint {
  /** Abscissa. */
  readonly downrange: number;
  /** Envelope height there. */
  readonly height: number;
  /** The elevation achieving it, radians. */
  readonly theta: number;
}

/** What {@link computeEnvelope} returns. */
export interface Envelope {
  /** The launch speed the boundary was measured at, m/s. */
  readonly speed: number;
  /** Sampled boundary points, ascending in {@link EnvelopePoint.downrange}. */
  readonly points: readonly EnvelopePoint[];
  /** The furthest abscissa any arc reaches — where the boundary meets the ground. */
  readonly maxDownrange: number;
  /** The elevation achieving {@link maxDownrange}, radians. */
  readonly maxRangeAngle: number;
  /** Trajectory integrations spent. */
  readonly evaluations: number;
}

/** What {@link assessReachability} returns. */
export interface ReachabilityReport {
  /** Whether some aim at this speed passes through the queried point. */
  readonly reachable: boolean;
  /** The point asked about, `[downrange, height]` in layout coordinates. */
  readonly target: readonly [number, number];
  /**
   * The envelope height directly above the target's abscissa, or `null` when
   * that abscissa is beyond {@link maxDownrange} and no arc reaches it at all.
   */
  readonly envelopeHeight: number | null;
  /**
   * Envelope height minus target height: the *vertical* clearance, positive
   * when the target sits under the boundary. `null` alongside a `null`
   * {@link envelopeHeight}.
   *
   * Reported next to {@link distanceToEnvelope} because the two answer
   * different questions and only one of them is cheap. This is "how much higher
   * could the shot be here", one maximization; the other is "how far is this
   * point from being makeable at all", a minimization over the whole boundary.
   */
  readonly heightMargin: number | null;
  /**
   * Shortest distance from the target to the boundary curve, metres. `0` when
   * reachable.
   *
   * This is the validation criterion's "distance-to-envelope": the Euclidean
   * miss in the plane, not the vertical drop. For a target far past the
   * maximum range the nearest boundary point is the ground end of the curve,
   * and the distance is measured to it.
   */
  readonly distanceToEnvelope: number;
  /** The nearest boundary point, or `null` when the target is reachable. */
  readonly nearestEnvelopePoint: readonly [number, number] | null;
  /** The furthest abscissa any arc reaches at this speed. */
  readonly maxDownrange: number;
  /** Trajectory integrations spent. */
  readonly evaluations: number;
}

const INVERSE_GOLDEN = (Math.sqrt(5) - 1) / 2;

/**
 * Golden-section maximization of a scalar function on a bracketing triple.
 *
 * **Deliberately local, and deliberately a near-twin of `arcs.ts`'s
 * `locatePeakAngle`.** The two maximize different things — that one the
 * range over elevation, this one the height at a fixed abscissa over elevation
 * — and folding them together needs a general 1D minimizer with its own
 * bracketing contract. That minimizer is **P5.13**, an unclaimed task in this
 * same phase. Writing it here would be claiming it out of order, and writing a
 * half-general version that P5.13 then has to replace is worse than a second
 * twenty-line contraction that it can delete. When P5.13 lands, both callers
 * should move onto it.
 *
 * Golden section rather than a derivative method for the reason `arcs.ts`
 * gives: each evaluation flies a trajectory, so a difference quotient costs two
 * of them and returns a derivative contaminated by the adaptive solver's
 * step-sequence noise.
 */
function goldenSectionMaximum(
  f: (x: number) => number,
  a0: number,
  b0: number,
  tol: number,
  maxIterations: number,
): { x: number; value: number } {
  let a = a0;
  let b = b0;
  let c = b - INVERSE_GOLDEN * (b - a);
  let d = a + INVERSE_GOLDEN * (b - a);
  let fc = f(c);
  let fd = f(d);
  for (let i = 0; i < maxIterations && b - a > tol; i++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - INVERSE_GOLDEN * (b - a);
      fc = f(c);
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + INVERSE_GOLDEN * (b - a);
      fd = f(d);
    }
  }
  const x = (a + b) / 2;
  return { x, value: f(x) };
}

/**
 * Sweeps `[lo, hi]` and returns the bracketing triple around the largest
 * sample, or the endpoint when the maximum is on the boundary.
 *
 * `-Infinity` samples are ordinary losers rather than a special case, which is
 * what lets an infeasible sub-interval sit inside the swept range without
 * needing to be excluded first.
 */
function bracketMaximum(
  f: (x: number) => number,
  lo: number,
  hi: number,
  samples: number,
): { a: number; b: number; best: number; bestValue: number; interior: boolean } {
  const step = (hi - lo) / (samples - 1);
  let bestIndex = 0;
  let bestValue = Number.NEGATIVE_INFINITY;
  for (let i = 0; i < samples; i++) {
    const value = f(lo + i * step);
    if (value > bestValue) {
      bestValue = value;
      bestIndex = i;
    }
  }
  const best = lo + bestIndex * step;
  if (bestIndex === 0 || bestIndex === samples - 1) {
    return { a: best, b: best, best, bestValue, interior: false };
  }
  return {
    a: lo + (bestIndex - 1) * step,
    b: lo + (bestIndex + 1) * step,
    best,
    bestValue,
    interior: true,
  };
}

/** Resolves {@link EnvelopeOptions} against its defaults. */
function resolve(options: EnvelopeOptions): {
  minAngle: number;
  maxAngle: number;
  sweepSamples: number;
  angleTol: number;
  maxIterations: number;
} {
  const minAngle = options.minAngle ?? 0;
  const maxAngle = options.maxAngle ?? Math.PI / 2;
  const sweepSamples = options.sweepSamples ?? 16;
  const angleTol = options.angleTol ?? 1e-7;
  const maxIterations = options.maxIterations ?? 200;
  if (!(maxAngle > minAngle)) {
    throw new Error(`envelope: maxAngle ${maxAngle} must exceed minAngle ${minAngle}`);
  }
  if (!Number.isInteger(sweepSamples) || sweepSamples < 3) {
    throw new Error(`envelope: sweepSamples must be an integer >= 3; got ${sweepSamples}`);
  }
  if (!(angleTol > 0)) {
    throw new Error(`envelope: angleTol must be positive; got ${angleTol}`);
  }
  return { minAngle, maxAngle, sweepSamples, angleTol, maxIterations };
}

/** Per-call integration bookkeeping shared by the entry points below. */
interface Sampler {
  /** Height of the arc at `theta` as it passes `downrange`, or `-Infinity`. */
  readonly heightAt: (theta: number, downrange: number) => number;
  /** Downrange reached by the arc at `theta`, or `-Infinity` if it never lands. */
  readonly rangeAt: (theta: number) => number;
  /** Integrations spent so far. */
  readonly count: () => number;
  readonly launchDownrange: number;
}

function createSampler(problem: ShootingProblem, speed: number): Sampler {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  const axis = downrangeAxisOf(layout);
  const xChannel = layout.position[axis]!;
  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  const fly = createFlight(problem);

  let evaluations = 0;
  const flyAt = (theta: number): Flight => {
    evaluations++;
    const aim: Aim = { theta, speed };
    return fly(aim);
  };

  return {
    heightAt: (theta, downrange) => {
      const flight = flyAt(theta);
      if (!flight.ok || flight.trajectory === null) return Number.NEGATIVE_INFINITY;
      const height = heightAtDownrange(flight.trajectory, downrange, layout);
      return height ?? Number.NEGATIVE_INFINITY;
    },
    rangeAt: (theta) => {
      const flight = flyAt(theta);
      if (!flight.ok || flight.trajectory === null) return Number.NEGATIVE_INFINITY;
      const traj = flight.trajectory;
      const column = traj.channels[xChannel]!;
      return column[traj.nSteps - 1]!;
    },
    count: () => evaluations,
    launchDownrange: launchPoint[axis]!,
  };
}

function requireSpeed(speed: number, what: string): void {
  if (!Number.isFinite(speed) || !(speed > 0)) {
    throw new Error(`${what}: speed must be finite and positive; got ${speed}`);
  }
}

/**
 * The envelope's height above one abscissa: $\max_\theta y(x; \theta)$.
 *
 * Returns `null` when no aim in the angle bounds reaches `downrange` at all —
 * the abscissa is outside the reachable set entirely, which is a different
 * statement from "reachable only at ground level" and is reported as such
 * rather than as a height of zero.
 *
 * @param problem Supplies the dynamics, launch point and solver settings. Its
 *   `target` is unused: this asks about an abscissa, not about a target.
 * @param speed The fixed launch speed, m/s.
 * @param downrange The abscissa, in the layout's downrange coordinate (absolute,
 *   not relative to the launch point).
 */
export function maxHeightAtDownrange(
  problem: ShootingProblem,
  speed: number,
  downrange: number,
  options: EnvelopeOptions = {},
): EnvelopeHeight | null {
  requireSpeed(speed, "maxHeightAtDownrange");
  if (!Number.isFinite(downrange)) {
    throw new Error(`maxHeightAtDownrange: downrange must be finite; got ${downrange}`);
  }
  const { minAngle, maxAngle, sweepSamples, angleTol, maxIterations } = resolve(options);
  const sampler = createSampler(problem, speed);

  const height = (theta: number): number => sampler.heightAt(theta, downrange);
  const bracket = bracketMaximum(height, minAngle, maxAngle, sweepSamples);

  if (bracket.bestValue === Number.NEGATIVE_INFINITY) return null;

  if (!bracket.interior) {
    return {
      downrange,
      height: bracket.bestValue,
      theta: bracket.best,
      evaluations: sampler.count(),
    };
  }

  const refined = goldenSectionMaximum(height, bracket.a, bracket.b, angleTol, maxIterations);
  // The sweep's best sample is kept as a candidate: golden section returns the
  // midpoint of its final bracket, which for a maximum sitting almost exactly
  // on a sample can evaluate a hair below it.
  if (refined.value >= bracket.bestValue) {
    return {
      downrange,
      height: refined.value,
      theta: refined.x,
      evaluations: sampler.count(),
    };
  }
  return {
    downrange,
    height: bracket.bestValue,
    theta: bracket.best,
    evaluations: sampler.count(),
  };
}

/**
 * The furthest abscissa any arc reaches at this speed, and the elevation that
 * gets there — the point where the boundary meets the ground.
 *
 * Measured with the same sweep-then-refine the heights use, on the range rather
 * than the height. This duplicates what `locatePeakAngle` does for
 * `solveArcs`, and calls it separately rather than reusing that function
 * because `PeakAngle` is documented as a *branch separator* whose tolerance is
 * deliberately loose (`1e-4` rad) for that job; here the same number is a
 * reported measurement and the curve's right-hand endpoint, so it is refined to
 * `angleTol`.
 */
function locateMaxRange(
  sampler: Sampler,
  bounds: { minAngle: number; maxAngle: number; sweepSamples: number; angleTol: number },
  maxIterations: number,
): { downrange: number; theta: number } {
  const { minAngle, maxAngle, sweepSamples, angleTol } = bounds;
  const bracket = bracketMaximum(sampler.rangeAt, minAngle, maxAngle, sweepSamples);
  if (bracket.bestValue === Number.NEGATIVE_INFINITY) {
    throw new Error(
      "envelope: no aim in the angle bounds produced an impact, so the reachable set has no " +
        "extent to measure; widen the problem's tspan or the angle bounds",
    );
  }
  if (!bracket.interior) {
    return { downrange: bracket.bestValue, theta: bracket.best };
  }
  const refined = goldenSectionMaximum(
    sampler.rangeAt,
    bracket.a,
    bracket.b,
    angleTol,
    maxIterations,
  );
  return refined.value >= bracket.bestValue
    ? { downrange: refined.value, theta: refined.x }
    : { downrange: bracket.bestValue, theta: bracket.best };
}

/**
 * Samples the whole boundary curve, for plotting and for the near-envelope
 * exhibits later in this phase (P5.23's conditioning readout sits on it).
 *
 * Abscissae are spaced uniformly from the launch point to the maximum range.
 * The last sample is the ground endpoint, where the height is zero by
 * construction — it is included rather than trimmed so the returned curve
 * closes on the ground rather than stopping just short of it.
 *
 * @param samples Boundary points to take, `>= 2`.
 */
export function computeEnvelope(
  problem: ShootingProblem,
  speed: number,
  samples = 24,
  options: EnvelopeOptions = {},
): Envelope {
  requireSpeed(speed, "computeEnvelope");
  if (!Number.isInteger(samples) || samples < 2) {
    throw new Error(`computeEnvelope: samples must be an integer >= 2; got ${samples}`);
  }
  const resolved = resolve(options);
  const sampler = createSampler(problem, speed);
  const extent = locateMaxRange(sampler, resolved, resolved.maxIterations);

  const points: EnvelopePoint[] = [];
  const lo = sampler.launchDownrange;
  const step = (extent.downrange - lo) / samples;
  let evaluations = sampler.count();
  for (let i = 1; i < samples; i++) {
    const downrange = lo + i * step;
    const height = maxHeightAtDownrange(problem, speed, downrange, options);
    if (height !== null) {
      evaluations += height.evaluations;
      points.push({ downrange, height: height.height, theta: height.theta });
    }
  }
  points.push({ downrange: extent.downrange, height: 0, theta: extent.theta });

  return {
    speed,
    points,
    maxDownrange: extent.downrange,
    maxRangeAngle: extent.theta,
    evaluations,
  };
}

/**
 * Whether a point in the plane can be hit at this speed, and if not, how far it
 * lies from the boundary.
 *
 * This is P5.09's validation criterion: *an unreachable target is reported with
 * its distance to the envelope.*
 *
 * **Reachability is decided vertically, distance is measured Euclidean, and the
 * two are separate steps on purpose.** Whether the target is inside the region
 * is settled by one maximization at its own abscissa — it is reachable exactly
 * when it sits no higher than the boundary there — and that answer is exact up
 * to the maximizer's tolerance. *How far outside* it lies is a different
 * question whose answer is the nearest point of a curve, and computing it needs
 * a minimization over the whole boundary. A caller that only needs the yes/no
 * pays for the first and not the second.
 *
 * **The minimization is a sweep and a contraction, and its limitation is
 * stated rather than assumed away.** Squared distance to a sampled curve is not
 * guaranteed unimodal for every boundary shape, so what is returned is the
 * nearest point found from the best of `boundarySamples` coarse probes, refined
 * by golden section. For the drag-free parabola and every scenario in the
 * library the function is single-basined and this is the global minimum; a
 * boundary contrived to be wavier than that could hide a second basin between
 * probes. Raising `boundarySamples` is the knob.
 *
 * @param target `[downrange, height]` in the layout's coordinates, absolute
 *   rather than relative to the launch point.
 * @param boundarySamples Coarse probes along the boundary for the distance
 *   minimization. Default `16`. Ignored when the target is reachable.
 */
export function assessReachability(
  problem: ShootingProblem,
  speed: number,
  target: readonly [number, number],
  options: EnvelopeOptions & { readonly boundarySamples?: number } = {},
): ReachabilityReport {
  requireSpeed(speed, "assessReachability");
  const [targetX, targetY] = target;
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) {
    throw new Error(`assessReachability: target must be finite; got [${targetX}, ${targetY}]`);
  }
  const resolved = resolve(options);
  const boundarySamples = options.boundarySamples ?? 16;
  if (!Number.isInteger(boundarySamples) || boundarySamples < 3) {
    throw new Error(
      `assessReachability: boundarySamples must be an integer >= 3; got ${boundarySamples}`,
    );
  }

  const extentSampler = createSampler(problem, speed);
  const extent = locateMaxRange(extentSampler, resolved, resolved.maxIterations);
  let evaluations = extentSampler.count();

  const above = maxHeightAtDownrange(problem, speed, targetX, options);
  if (above !== null) evaluations += above.evaluations;

  const envelopeHeight = above?.height ?? null;
  const heightMargin = envelopeHeight === null ? null : envelopeHeight - targetY;

  if (heightMargin !== null && heightMargin >= 0) {
    return {
      reachable: true,
      target,
      envelopeHeight,
      heightMargin,
      distanceToEnvelope: 0,
      nearestEnvelopePoint: null,
      maxDownrange: extent.downrange,
      evaluations,
    };
  }

  // Unreachable. Minimize squared distance to the boundary over its abscissa
  // span. Negated because the contraction below maximizes.
  const lo = extentSampler.launchDownrange;
  const hi = extent.downrange;
  const negSquaredDistance = (x: number): number => {
    const point = maxHeightAtDownrange(problem, speed, x, options);
    if (point === null) return Number.NEGATIVE_INFINITY;
    evaluations += point.evaluations;
    const dx = x - targetX;
    const dy = point.height - targetY;
    return -(dx * dx + dy * dy);
  };

  const bracket = bracketMaximum(negSquaredDistance, lo, hi, boundarySamples);
  let bestX = bracket.best;
  let bestValue = bracket.bestValue;
  let endpointIsNearest = false;
  if (bracket.interior) {
    const refined = goldenSectionMaximum(
      negSquaredDistance,
      bracket.a,
      bracket.b,
      Math.max((hi - lo) * 1e-6, Number.MIN_VALUE),
      resolved.maxIterations,
    );
    if (refined.value >= bestValue) {
      bestX = refined.x;
      bestValue = refined.value;
    }
  }

  // The ground endpoint is known exactly and cannot be sampled for. It is the
  // one abscissa reached by a single elevation, so the theta sweep above has
  // measure-zero odds of landing on it and `maxHeightAtDownrange` returns
  // `null` there; without this candidate the minimization stops short of the
  // curve's end, which is precisely where a too-far ground target's nearest
  // point lies. Its height is zero by construction: the max-range arc gets
  // there by landing.
  {
    const dx = extent.downrange - targetX;
    const dy = 0 - targetY;
    const endpointValue = -(dx * dx + dy * dy);
    if (endpointValue > bestValue) {
      bestValue = endpointValue;
      bestX = extent.downrange;
      endpointIsNearest = true;
    }
  }

  if (bestValue === Number.NEGATIVE_INFINITY) {
    throw new Error(
      "assessReachability: no boundary probe between the launch point and the maximum range " +
        "yielded a height, so there is no curve to measure a distance to. This means the " +
        "angle bounds admit impacts but no mid-flight passes, which a `maxAngle` at or below " +
        "the launch elevation can produce; widen them.",
    );
  }

  let nearestPoint: readonly [number, number] | null = null;
  if (endpointIsNearest) {
    nearestPoint = [extent.downrange, 0];
  } else {
    const nearest = maxHeightAtDownrange(problem, speed, bestX, options);
    if (nearest !== null) {
      evaluations += nearest.evaluations;
      nearestPoint = [bestX, nearest.height];
    }
  }

  return {
    reachable: false,
    target,
    envelopeHeight,
    heightMargin,
    distanceToEnvelope: Math.sqrt(-bestValue),
    nearestEnvelopePoint: nearestPoint,
    maxDownrange: extent.downrange,
    evaluations,
  };
}
