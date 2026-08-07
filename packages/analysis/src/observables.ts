import type { Trajectory } from "@ballista/solverkit";

/**
 * Where the position and velocity components of a model's state live in a
 * {@link Trajectory}'s `channels` array (P5.01, §9.1). The observables below
 * are deliberately layout-parameterised rather than hard-coded to
 * `[x, y, vx, vy]`: the same `range`/`apexHeight`/`impactSpeed` code has to
 * serve the planar projectile, the spatial one, and (Stage B, §2.4) whatever
 * else the model registry grows, and a channel-index table is the smallest
 * seam that buys that.
 *
 * `vertical` is an index *into* `position`/`velocity`, not into `channels` --
 * it names which component is "up" (element 1 for both shipped projectile
 * models, whose channel orders are `[x, y, vx, vy]` and
 * `[x, y, z, vx, vy, vz]`), so a caller reading horizontal components can
 * skip it without knowing the absolute channel numbering.
 */
export interface TrajectoryLayout {
  /** Channel indices of the position components, in axis order. */
  readonly position: readonly number[];
  /** Channel indices of the velocity components, in the same axis order as {@link position}. */
  readonly velocity: readonly number[];
  /** Index *within* `position`/`velocity` of the vertical (gravity-aligned) axis. */
  readonly vertical: number;
}

/** Layout of `createPlanarProjectileModel`'s `[x, y, vx, vy]` state (`PLANAR_CHANNELS`). */
export const PLANAR_LAYOUT: TrajectoryLayout = Object.freeze({
  position: Object.freeze([0, 1]),
  velocity: Object.freeze([2, 3]),
  vertical: 1,
});

/** Layout of `createSpatialProjectileModel`'s `[x, y, z, vx, vy, vz]` state (`SPATIAL_CHANNELS`). */
export const SPATIAL_LAYOUT: TrajectoryLayout = Object.freeze({
  position: Object.freeze([0, 1, 2]),
  velocity: Object.freeze([3, 4, 5]),
  vertical: 1,
});

/**
 * Reads channel `channel` at row `row`, failing loudly rather than yielding
 * `NaN` when a layout names a channel the trajectory does not carry -- the
 * realistic mistake here is pairing `SPATIAL_LAYOUT` with a planar solve,
 * and silently returning `undefined`-turned-`NaN` would surface that as an
 * unexplained `NaN` observable several call frames later.
 */
function at(traj: Trajectory, channel: number, row: number): number {
  const column = traj.channels[channel];
  if (column === undefined) {
    throw new Error(
      `observable layout names channel ${channel}, but the trajectory has only ${traj.channels.length}`,
    );
  }
  return column[row]!;
}

/** Throws unless the trajectory has at least `min` recorded rows. */
function requireRows(traj: Trajectory, min: number, what: string): void {
  if (traj.nSteps < min) {
    throw new Error(`${what} needs at least ${min} recorded row(s); trajectory has ${traj.nSteps}`);
  }
}

/**
 * Throws unless *every* channel the layout names exists on the trajectory.
 *
 * Checking the whole layout up front, rather than relying on {@link at} to
 * catch a missing channel when it is read, is the difference between failing
 * and failing silently. Pairing `SPATIAL_LAYOUT` with a planar solve is the
 * realistic mistake, and a planar trajectory has *enough* channels to satisfy
 * some of what the spatial layout asks for: `range` would skip the vertical
 * axis, read channels 0 and 2, find `vx` sitting where it expected `z`, and
 * return a confidently wrong number rather than throwing. A lazy per-read
 * guard cannot see that; a whole-layout guard can.
 */
function requireLayout(traj: Trajectory, layout: TrajectoryLayout, what: string): void {
  const needed = Math.max(...layout.position, ...layout.velocity) + 1;
  if (traj.channels.length < needed) {
    throw new Error(
      `${what}: layout spans ${needed} channel(s), but the trajectory has only ${traj.channels.length}`,
    );
  }
  if (layout.vertical < 0 || layout.vertical >= layout.position.length) {
    throw new Error(
      `${what}: layout vertical axis ${layout.vertical} is outside its ${layout.position.length} position axes`,
    );
  }
}

/**
 * Index of the final recorded row -- **the impact row**, for any solve that
 * ended on a terminal ground event.
 *
 * This is the load-bearing assumption behind `range`, `timeOfFlight`,
 * `impactSpeed` and `missDistance`, so it is worth stating plainly: none of
 * those four observables does any interpolation. `integrate` root-localizes
 * every terminal crossing and dispatches the *localized* state to its sinks
 * before returning (§4.9), so the recorder's last row already sits on the
 * event surface to the solver's event tolerance. Their accuracy is therefore
 * inherited from event localization, not produced here -- and a trajectory
 * that ended by exhausting `tspan` or `maxSteps` instead has a perfectly
 * ordinary final row that these functions will happily, and meaninglessly,
 * report as an impact. Check `SolveReport.status` before trusting them.
 */
function lastRow(traj: Trajectory): number {
  return traj.nSteps - 1;
}

/** Euclidean norm of the velocity components at row `row`. */
function speedAt(traj: Trajectory, layout: TrajectoryLayout, row: number): number {
  let sum = 0;
  for (const channel of layout.velocity) {
    const v = at(traj, channel, row);
    sum += v * v;
  }
  return Math.sqrt(sum);
}

/**
 * Time of flight: the span of recorded time, `t_final - t_0` (§9.1).
 *
 * Relative to `t_0` rather than absolute, so a scenario launched at a
 * non-zero epoch reports the flight duration and not the clock reading.
 */
export function timeOfFlight(traj: Trajectory): number {
  requireRows(traj, 1, "timeOfFlight");
  return traj.t[lastRow(traj)]! - traj.t[0]!;
}

/**
 * Horizontal range: the distance from the launch point to the impact point
 * measured in the horizontal plane, i.e. with the vertical axis excluded
 * (§9.1).
 *
 * Excluding the vertical component is what makes this the quantity the
 * drag-free formula $R = v_0^2 \sin 2\theta / g$ predicts, and it keeps the
 * observable meaningful for a launch that lands above or below its origin
 * (raised platform, sloped terrain) where the straight-line launch-to-impact
 * distance and the range differ. For the planar model this reduces to
 * $|x_{\text{imp}} - x_0|$; in 3D it is the norm of the horizontal
 * displacement, so a Coriolis-deflected shot's range is its ground-track
 * distance and not merely its downrange coordinate.
 */
export function range(traj: Trajectory, layout: TrajectoryLayout = PLANAR_LAYOUT): number {
  requireRows(traj, 1, "range");
  requireLayout(traj, layout, "range");
  const last = lastRow(traj);
  let sum = 0;
  for (let axis = 0; axis < layout.position.length; axis++) {
    if (axis === layout.vertical) continue;
    const channel = layout.position[axis]!;
    const d = at(traj, channel, last) - at(traj, channel, 0);
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * Position components at the impact row, in layout axis order.
 *
 * Added for P5.02, whose target model needs the impact *point* rather than a
 * scalar derived from it. Carries {@link lastRow}'s caveat unchanged: this is
 * the final recorded row, which is the event-localized impact state only for
 * a solve that ended on a terminal event.
 */
export function impactPoint(traj: Trajectory, layout: TrajectoryLayout = PLANAR_LAYOUT): number[] {
  requireRows(traj, 1, "impactPoint");
  requireLayout(traj, layout, "impactPoint");
  const last = lastRow(traj);
  return layout.position.map((channel) => at(traj, channel, last));
}

/** Speed $|\mathbf v|$ at the impact row (§9.1). */
export function impactSpeed(traj: Trajectory, layout: TrajectoryLayout = PLANAR_LAYOUT): number {
  requireRows(traj, 1, "impactSpeed");
  requireLayout(traj, layout, "impactSpeed");
  return speedAt(traj, layout, lastRow(traj));
}

/**
 * Euclidean distance from the impact point to `target`, over **all** position
 * axes including the vertical one (§9.1).
 *
 * Whole-vector rather than horizontal-only because this is the scalar a
 * shooting residual is driven to zero (P5.04): a shot that lands at the
 * right downrange distance but on the wrong side of a raised platform has
 * missed, and an observable that reported zero there would make the residual
 * blind to exactly the case the target model (P5.02) exists to distinguish.
 * The richer point/ring/platform predicates and the signed miss *vector*
 * are P5.02's job; this is the scalar magnitude.
 */
export function missDistance(
  traj: Trajectory,
  target: readonly number[],
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number {
  requireRows(traj, 1, "missDistance");
  requireLayout(traj, layout, "missDistance");
  if (target.length !== layout.position.length) {
    throw new Error(
      `missDistance target has ${target.length} component(s); layout expects ${layout.position.length}`,
    );
  }
  const last = lastRow(traj);
  let sum = 0;
  for (let axis = 0; axis < layout.position.length; axis++) {
    const d = at(traj, layout.position[axis]!, last) - target[axis]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

/**
 * The apex of a Hermite-interpolated arc: `{ t, height }` at the trajectory's
 * highest point.
 *
 * Unlike the impact observables, this one **cannot** just read a recorded
 * row. The apex almost never coincides with a step boundary, so taking the
 * row-wise maximum of the vertical position is $O(h^2)$ accurate -- nowhere
 * near P5.01's 1e-9 criterion at any step size a solver would actually use.
 *
 * So each downward zero-crossing of the vertical velocity is refined instead.
 * Across one bracketing step the vertical position is modelled by the same
 * cubic Hermite basis the dense-output stepper uses (§4.9): value and
 * derivative matched at both ends, using the recorded $v_y$ channel as the
 * derivative -- available for free here, since $\dot y = v_y$ is a state
 * channel and not something that needs an extra `rhs` call. Differentiating
 * that cubic gives a *quadratic* in $\theta$ whose root in $[0, 1]$ is the
 * apex, solved in closed form.
 *
 * This is exact to roundoff on the drag-free case, and not by luck: there
 * $y(t)$ is a quadratic and $v_y(t)$ is linear, a cubic Hermite reproduces
 * any cubic exactly, so the interpolant *is* the true arc and its stationary
 * point *is* the true apex. Under drag the interpolant is locally 3rd order,
 * so the height error is $O(h^4)$ near a stationary point rather than
 * $O(h^2)$.
 *
 * Every crossing is refined, not just the first, and the recorded endpoints
 * are included as candidates. That covers the two cases a first-crossing-only
 * scan gets wrong: a bouncing trajectory (P4.11), whose later arcs each have
 * their own apex, and a monotonic arc with no interior crossing at all --
 * a downward launch, whose apex is its launch point, or a solve cut off
 * while still climbing, whose apex is its final row.
 */
export function apex(
  traj: Trajectory,
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): { readonly t: number; readonly height: number } {
  requireRows(traj, 1, "apex");
  requireLayout(traj, layout, "apex");
  const yChannel = layout.position[layout.vertical]!;
  const vyChannel = layout.velocity[layout.vertical]!;
  const last = lastRow(traj);

  // Endpoints are always candidates: they are the answer when no interior
  // crossing exists, and they cost nothing when one does.
  let bestT = traj.t[0]!;
  let bestHeight = at(traj, yChannel, 0);
  const consider = (t: number, height: number): void => {
    if (height > bestHeight) {
      bestHeight = height;
      bestT = t;
    }
  };
  consider(traj.t[last]!, at(traj, yChannel, last));

  for (let k = 0; k < last; k++) {
    const vy0 = at(traj, vyChannel, k);
    const vy1 = at(traj, vyChannel, k + 1);
    // Downward crossings only: v_y >= 0 -> v_y < 0 is a maximum of y, while
    // the upward crossing on a bouncing arc is a minimum and would drag the
    // scan toward the ground rather than the apex.
    if (!(vy0 >= 0 && vy1 < 0)) continue;

    const t0 = traj.t[k]!;
    const h = traj.t[k + 1]! - t0;
    if (h <= 0) continue;
    const y0 = at(traj, yChannel, k);
    const y1 = at(traj, yChannel, k + 1);

    const theta = hermiteStationaryPoint(y0, vy0, y1, vy1, h);
    if (theta === undefined) continue;
    consider(t0 + theta * h, hermiteValue(y0, vy0, y1, vy1, h, theta));
  }

  return { t: bestT, height: bestHeight };
}

/** Apex height above the datum: `apex(traj, layout).height` (§9.1). */
export function apexHeight(traj: Trajectory, layout: TrajectoryLayout = PLANAR_LAYOUT): number {
  return apex(traj, layout).height;
}

/** Time at which the apex occurs, on the trajectory's own clock (§9.1). */
export function apexTime(traj: Trajectory, layout: TrajectoryLayout = PLANAR_LAYOUT): number {
  return apex(traj, layout).t;
}

/**
 * Scalar cubic Hermite value at $\theta \in [0,1]$ across a step of size `h`,
 * matching {@link hermiteInterpolant}'s basis but for one component, so this
 * module can interpolate a single channel without allocating an output
 * `Float64Array` per candidate crossing.
 */
function hermiteValue(
  y0: number,
  d0: number,
  y1: number,
  d1: number,
  h: number,
  theta: number,
): number {
  const t2 = theta * theta;
  const t3 = t2 * theta;
  return (
    (2 * t3 - 3 * t2 + 1) * y0 +
    h * (t3 - 2 * t2 + theta) * d0 +
    (-2 * t3 + 3 * t2) * y1 +
    h * (t3 - t2) * d1
  );
}

/**
 * The $\theta \in [0, 1]$ at which the cubic Hermite interpolant above is
 * stationary, or `undefined` if it has no stationary point in the open
 * bracket.
 *
 * $dy/d\theta$ is the quadratic $a\theta^2 + b\theta + c$ below, solved with
 * the sign-stable form $q = -\tfrac12(b + \mathrm{sign}(b)\sqrt{b^2-4ac})$
 * rather than the textbook formula, whose subtractive cancellation costs
 * digits in exactly the near-degenerate case ($|a| \ll |b|$, a nearly-linear
 * derivative) that a small step naturally produces. When $a$ *is* zero the
 * derivative is genuinely linear and the root is $-c/b$ directly.
 *
 * Both roots are tried because a cubic has two stationary points and only
 * their bracketing decides which is the maximum here; the caller compares
 * heights, so returning the one inside $[0,1]$ is enough.
 */
function hermiteStationaryPoint(
  y0: number,
  d0: number,
  y1: number,
  d1: number,
  h: number,
): number | undefined {
  const dy = y1 - y0;
  const a = 3 * (h * d0 + h * d1 - 2 * dy);
  const b = 2 * (3 * dy - 2 * h * d0 - h * d1);
  const c = h * d0;

  const roots: number[] = [];
  if (a === 0) {
    if (b !== 0) roots.push(-c / b);
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < 0) return undefined;
    const sqrtDisc = Math.sqrt(disc);
    const q = -0.5 * (b + (b >= 0 ? sqrtDisc : -sqrtDisc));
    roots.push(q / a);
    if (q !== 0) roots.push(c / q);
  }

  for (const root of roots) {
    if (root >= 0 && root <= 1) return root;
  }
  return undefined;
}
