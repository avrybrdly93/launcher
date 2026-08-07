import type { Trajectory } from "@ballista/solverkit";

import { PLANAR_LAYOUT, type TrajectoryLayout, impactPoint } from "./observables.js";

/**
 * A target the inverse solvers of §7 Phase 5 aim at (P5.02).
 *
 * Every target is a **set of points** in the position space of a
 * {@link TrajectoryLayout}, and every operation below is defined in terms of
 * that set rather than per-kind:
 *
 * - {@link missVector} is `impact - nearest point of the set`;
 * - {@link missMagnitude} is its norm;
 * - {@link isHit} is `missMagnitude <= tolerance`.
 *
 * Defining the three shapes as *sets* and the miss as a *nearest-point
 * displacement* is what makes "the miss vector is zero exactly when the shot
 * hits" a consequence rather than three separate special cases -- and it is
 * what keeps the residual P5.04 will drive to zero continuous as the impact
 * point moves, including across the target boundary, where a kind-specific
 * formula would be the natural place to introduce a kink.
 */
export type Target = PointTarget | RingTarget | PlatformTarget;

/** Fields every target kind carries. */
interface TargetBase {
  /**
   * Position of the target's reference point, in the same axis order and
   * length as the layout's `position`. For {@link RingTarget} and
   * {@link PlatformTarget} this is the centre, and its vertical component is
   * the height of the target surface.
   */
  readonly center: readonly number[];
  /**
   * Miss magnitude, in metres, at or below which {@link isHit} reports a hit.
   * Defaults to `0`.
   *
   * **A zero tolerance is the right default for a constructed point and the
   * wrong one for a solver's impact point**, and the reason is worth stating
   * because it is easy to get backwards. All three shapes here are *flat*:
   * their vertical extent is zero, so the miss vector picks up the full
   * difference between the shot's vertical coordinate and the target's. A
   * point placed on the target by hand has that difference at exactly zero.
   * A ground impact produced by event localization does not — it sits on the
   * event surface to the solver's event tolerance, which is around `1e-15` m
   * for a tight drag-free solve but is never `0`. So a trajectory-level hit
   * test against a ring or a platform needs a tolerance that reflects what
   * counts as "on it" physically (a shell radius, a scoring ring width),
   * not the solver's arithmetic.
   *
   * {@link missVector} is unaffected by any of this: it reports the geometry,
   * and only the predicate consults the tolerance.
   */
  readonly tolerance?: number;
}

/**
 * A single point. The limiting case of the other two, and the target shape
 * P5.03's scalar root problem and P5.04's residual are written against:
 * `missVector` for a point target is exactly `r_impact - r*`.
 */
export interface PointTarget extends TargetBase {
  readonly kind: "point";
}

/**
 * A horizontal disc (or annulus) at the height of `center` -- the classic
 * ground target ring, and the shape Phase 6's dispersion ellipses will be
 * scored against.
 *
 * `radius` is the outer radius; `innerRadius` defaults to `0`, which makes
 * the target a filled disc. A non-zero `innerRadius` makes it a true annulus,
 * where the *centre* of the ring is a miss.
 */
export interface RingTarget extends TargetBase {
  readonly kind: "ring";
  /** Outer radius, metres. Must be finite and `>= innerRadius`. */
  readonly radius: number;
  /** Inner radius, metres. Defaults to 0 (a filled disc). */
  readonly innerRadius?: number;
}

/**
 * A raised horizontal pad: an axis-aligned rectangle in the horizontal plane
 * at the height of `center`.
 *
 * Its vertical extent is deliberately zero -- this models landing *on top of*
 * a platform, not entering a box. That is the case
 * {@link missDistance}'s doc comment in `observables.ts` singles out: a shot
 * at the right downrange distance but at the wrong height has hit the side of
 * the platform, not the top, and the miss vector says so in its vertical
 * component.
 */
export interface PlatformTarget extends TargetBase {
  readonly kind: "platform";
  /**
   * Half-width along each **horizontal** axis, in layout axis order with the
   * vertical axis omitted -- so a planar layout takes one entry and a spatial
   * layout takes two. Each must be finite and non-negative.
   */
  readonly halfExtents: readonly number[];
}

/** Number of horizontal axes a layout has. */
function horizontalAxisCount(layout: TrajectoryLayout): number {
  return layout.position.length - 1;
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${what} must be finite; got ${value}`);
  }
}

/**
 * Throws unless `target` is well-formed for `layout`.
 *
 * Checked up front rather than defended against per-axis mid-computation: a
 * `center` of the wrong length would otherwise read `undefined` for the
 * missing axis, turn it into `NaN`, and hand a `NaN` residual to a Newton
 * iteration that has no way to attribute it.
 */
export function validateTarget(target: Target, layout: TrajectoryLayout = PLANAR_LAYOUT): void {
  const dim = layout.position.length;
  if (target.center.length !== dim) {
    throw new Error(
      `target center has ${target.center.length} component(s); layout expects ${dim}`,
    );
  }
  for (let axis = 0; axis < dim; axis++) {
    requireFinite(target.center[axis]!, `target center[${axis}]`);
  }
  if (target.tolerance !== undefined) {
    requireFinite(target.tolerance, "target tolerance");
    if (target.tolerance < 0) {
      throw new Error(`target tolerance must be >= 0; got ${target.tolerance}`);
    }
  }

  switch (target.kind) {
    case "point":
      return;
    case "ring": {
      const inner = target.innerRadius ?? 0;
      requireFinite(target.radius, "ring radius");
      requireFinite(inner, "ring innerRadius");
      if (inner < 0) throw new Error(`ring innerRadius must be >= 0; got ${inner}`);
      if (target.radius < inner) {
        throw new Error(`ring radius ${target.radius} is smaller than innerRadius ${inner}`);
      }
      return;
    }
    case "platform": {
      const nHorizontal = horizontalAxisCount(layout);
      if (target.halfExtents.length !== nHorizontal) {
        throw new Error(
          `platform halfExtents has ${target.halfExtents.length} entry(s); layout has ${nHorizontal} horizontal axis(es)`,
        );
      }
      for (let i = 0; i < target.halfExtents.length; i++) {
        const extent = target.halfExtents[i]!;
        requireFinite(extent, `platform halfExtents[${i}]`);
        if (extent < 0) throw new Error(`platform halfExtents[${i}] must be >= 0; got ${extent}`);
      }
      return;
    }
  }
}

/**
 * The point of `target` closest to `point`, in the layout's position space.
 *
 * Exposed because it is what makes the miss vector interpretable: it is the
 * spot the shot *should* have hit, which is what an annotation layer (§6.1)
 * draws the miss line to.
 *
 * Degenerate case worth naming: for an annulus, a point at the exact centre
 * is equidistant from every point of the inner rim. There is no canonical
 * answer, so the first horizontal axis is chosen deterministically rather
 * than left to floating-point accident — an arbitrary choice, but a *stable*
 * one, which is what a solver stepping through the centre needs.
 */
export function nearestPointOn(
  target: Target,
  point: readonly number[],
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number[] {
  validateTarget(target, layout);
  const dim = layout.position.length;
  if (point.length !== dim) {
    throw new Error(`point has ${point.length} component(s); layout expects ${dim}`);
  }

  if (target.kind === "point") {
    return [...target.center];
  }

  // Both extended shapes are flat: the vertical component of the nearest
  // point is the target's own height, whatever the shot did vertically.
  const nearest = [...target.center];

  if (target.kind === "platform") {
    let horizontal = 0;
    for (let axis = 0; axis < dim; axis++) {
      if (axis === layout.vertical) continue;
      const half = target.halfExtents[horizontal]!;
      const c = target.center[axis]!;
      nearest[axis] = clamp(point[axis]!, c - half, c + half);
      horizontal++;
    }
    return nearest;
  }

  // Ring: clamp the in-plane radius into [innerRadius, radius], keeping the
  // bearing from the centre.
  const inner = target.innerRadius ?? 0;
  let sum = 0;
  for (let axis = 0; axis < dim; axis++) {
    if (axis === layout.vertical) continue;
    const d = point[axis]! - target.center[axis]!;
    sum += d * d;
  }
  const r = Math.sqrt(sum);

  if (r === 0) {
    if (inner === 0) return nearest; // Dead centre of a filled disc: already on it.
    // Equidistant from the whole inner rim; pick the first horizontal axis.
    const firstHorizontal = layout.vertical === 0 ? 1 : 0;
    nearest[firstHorizontal] = target.center[firstHorizontal]! + inner;
    return nearest;
  }

  const clamped = clamp(r, inner, target.radius);
  if (clamped === r) {
    // Already inside the annulus horizontally: copy the components across
    // rather than scaling them by a ratio that happens to be 1. `center + (p
    // - center) * 1` is not bit-identical to `p` in floating point, and this
    // is exactly the branch on which the miss vector has to come out as
    // *exact* zero.
    for (let axis = 0; axis < dim; axis++) {
      if (axis === layout.vertical) continue;
      nearest[axis] = point[axis]!;
    }
    return nearest;
  }

  const scale = clamped / r;
  for (let axis = 0; axis < dim; axis++) {
    if (axis === layout.vertical) continue;
    nearest[axis] = target.center[axis]! + (point[axis]! - target.center[axis]!) * scale;
  }
  return nearest;
}

/**
 * `point - nearestPointOn(target, point)`: how far, and in which direction,
 * the shot landed away from the target.
 *
 * **Sign convention:** impact minus target, so for a {@link PointTarget} this
 * is literally the residual $F = \mathbf r_{\text{impact}} - \mathbf r^*$
 * that §7's P5.04 defines. A Newton step therefore consumes it directly, with
 * no sign to remember at the call site.
 *
 * Zero — exactly, in floating point, not merely small — whenever `point` lies
 * on the target, since the nearest point is then `point` itself componentwise.
 * That is P5.02's validation criterion.
 */
export function missVector(
  target: Target,
  point: readonly number[],
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number[] {
  const nearest = nearestPointOn(target, point, layout);
  const miss: number[] = [];
  for (let axis = 0; axis < layout.position.length; axis++) {
    miss.push(point[axis]! - nearest[axis]!);
  }
  return miss;
}

/** Euclidean norm of {@link missVector}. */
export function missMagnitude(
  target: Target,
  point: readonly number[],
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number {
  let sum = 0;
  for (const component of missVector(target, point, layout)) {
    sum += component * component;
  }
  return Math.sqrt(sum);
}

/**
 * Whether `point` hits `target`: `missMagnitude <= target.tolerance ?? 0`.
 *
 * Note the tolerance is a property of the *target*, not an argument here, so
 * that a scenario's success criterion travels with the scenario rather than
 * being re-supplied (and re-guessed) at every call site.
 */
export function isHit(
  target: Target,
  point: readonly number[],
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): boolean {
  return missMagnitude(target, point, layout) <= (target.tolerance ?? 0);
}

/**
 * {@link missVector} evaluated at a trajectory's impact point.
 *
 * Inherits every caveat {@link impactPoint} carries: the impact row is the
 * final recorded row, which is the event-localized state only for a solve
 * that ended on a terminal event. A run that exhausted `tspan` or `maxSteps`
 * has an ordinary final row, and this will report a miss against it as if it
 * were an impact. Check `SolveReport.status` first.
 */
export function impactMissVector(
  traj: Trajectory,
  target: Target,
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): number[] {
  return missVector(target, impactPoint(traj, layout), layout);
}

/** Whether a trajectory's impact point hits `target`. */
export function impactIsHit(
  traj: Trajectory,
  target: Target,
  layout: TrajectoryLayout = PLANAR_LAYOUT,
): boolean {
  return isHit(target, impactPoint(traj, layout), layout);
}

function clamp(value: number, low: number, high: number): number {
  if (value < low) return low;
  if (value > high) return high;
  return value;
}
