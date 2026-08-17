import { EnvSample, G_STD } from "@ballista/engine";

import { PLANAR_LAYOUT, type TrajectoryLayout, downrangeAxisOf } from "./observables.js";
import type { Aim, ShootingProblem } from "./shooting-residual.js";

/**
 * The smart initializer of §7 Phase 5 (P5.07): the closed-form drag-free aim
 * that P5.04's residual and P5.06's Newton solve start from.
 *
 * P5.06's validation criterion already says "from smart init" and this is the
 * thing it names; until now it did not exist, so that criterion was measured
 * from hand-chosen rough aims and its iteration count recorded as an upper
 * bound rather than a measurement (see the P5.06 CHANGELOG entry).
 *
 * **The difficulty here is not the algebra, it is that the problem is
 * under-determined.** "Which drag-free aim reaches the point `(Δx, Δy)`" has a
 * one-parameter *family* of answers — one equation, two unknowns — which is the
 * same degeneracy P5.05 measured as a rank-1 Jacobian and P5.08 will surface as
 * the low and high arcs. A closed form therefore has to *choose* a point on
 * that curve, and the choice is the design decision this module makes.
 *
 * **It chooses the minimum-speed solution**, because that is the one point the
 * geometry alone determines: no launcher parameter, no arc preference, and no
 * tuning constant enters it. Every other closed form on the curve needs one
 * more input than the target — a muzzle speed, or an elevation — and supplying
 * one of those *and* selecting an arc is exactly P5.08's job, not this task's.
 *
 * **What it deliberately does not do is correct for drag.** The task is the
 * drag-free closed form, and a drag correction would have to be either a fitted
 * constant (not closed form, and wrong outside its fit) or an iteration (which
 * is the Newton solve this feeds). The consequence is stated plainly rather
 * than hidden: with drag on, this aim *undershoots*, and the initializer's job
 * is only to land inside the basin from which Newton converges — which is what
 * P5.07's validation criterion measures over the whole scenario library.
 */

/**
 * The drag-free minimum-speed aim from a launch point to a target displaced by
 * `(downrange, rise)`.
 *
 * With `φ = atan2(rise, downrange)` the line-of-sight elevation and
 * `R = hypot(downrange, rise)` the slant range,
 *
 * $$\theta = \frac{\pi}{4} + \frac{\varphi}{2}, \qquad
 *   v_0 = \sqrt{g\,(\Delta y + R)}.$$
 *
 * Both are exact, not approximations: `θ` bisects the vertical and the
 * line of sight, and `v₀` is the classic `√(g(Δy + R))` minimum-energy speed.
 * Flat ground (`rise = 0`) recovers the textbook `θ = 45°`, `v₀ = √(g·Δx)`; a
 * target directly overhead recovers `θ = 90°`, `v₀ = √(2 g Δy)`, the exact
 * speed needed to rise `Δy`.
 *
 * **A negative `downrange` is a supported case, not a caller error.** The aim
 * `(θ, v₀)` of {@link Aim} launches at `v₀cos θ` along the downrange axis, so
 * `θ ∈ (π/2, π)` fires *backwards*, and the formula produces exactly that:
 * `φ → π` gives `θ → 3π/4`. Rejecting it would make the initializer wrong for
 * half the plane on nothing better than a sign convention.
 *
 * @param downrange Horizontal displacement to the target along the aim's
 *   downrange axis, metres. May be negative (target behind the launcher).
 * @param rise Vertical displacement to the target, metres. Negative for a
 *   target below the launch point.
 * @param gravity Gravitational acceleration, m/s². Must be finite and positive.
 * @throws If any argument is non-finite, if `gravity <= 0`, or if the target
 *   lies at or directly below the launch point — see below.
 *
 * **The excluded case is `Δy + R = 0`**, which happens exactly when
 * `downrange = 0` and `rise ≤ 0`: the target is the launch point itself or
 * directly beneath it. The minimum-speed answer there is real and useless —
 * *drop it*, `v₀ = 0` — and a zero-speed aim hands Newton a zero Jacobian and
 * no direction to move in. That is a statement about the problem rather than a
 * numerical failure, so it throws rather than returning an aim the caller would
 * have to know to distrust.
 */
export function dragFreeAim(downrange: number, rise: number, gravity: number = G_STD): Aim {
  requireFinite(downrange, "downrange");
  requireFinite(rise, "rise");
  requireFinite(gravity, "gravity");
  if (!(gravity > 0)) {
    throw new Error(`dragFreeAim: gravity must be positive; got ${gravity}`);
  }

  // Negative zero would send `atan2(-0, -x)` to −π instead of +π, flipping a
  // backwards-and-up shot into a forwards-and-down one across a boundary the
  // physics does not have. Normalizing it away costs one comparison.
  const dy = rise === 0 ? 0 : rise;
  const slantRange = Math.hypot(downrange, dy);
  // `Δy + R` is written two ways because it cancels catastrophically one way
  // round. For a target below the launch point, `Δy` and `R` are nearly equal
  // and opposite — a 1 m offset 400 m down has `Δy = −400`, `R = 400.00125`,
  // and their sum keeps about 3 of the 16 digits it was formed from. Since
  // `R² − Δy² = Δx²` exactly, `Δy + R = Δx² / (R − Δy)`, and for `Δy < 0` that
  // denominator is a sum of like signs with nothing to cancel. Measured on the
  // test's own grid, the difference is a relative error of `4e-11` against
  // `4e-16` — the naive form is not wrong, it is four orders of magnitude
  // looser than the arithmetic it is made of. The `Δy >= 0` branch keeps the
  // direct form, where nothing cancels and `R − Δy` is the expression that
  // would divide by zero (a target straight overhead).
  const speedSquared =
    gravity * (dy >= 0 ? dy + slantRange : (downrange * downrange) / (slantRange - dy));
  if (!(speedSquared > 0)) {
    throw new Error(
      "dragFreeAim: the target is at or directly below the launch point " +
        `(downrange = ${downrange}, rise = ${rise}), where the minimum-speed solution is a ` +
        "drop from rest and carries no aim; supply a target with a horizontal offset",
    );
  }

  return {
    theta: Math.PI / 4 + Math.atan2(dy, downrange) / 2,
    speed: Math.sqrt(speedSquared),
  };
}

/** Tuning for {@link smartInitialAim}. Both fields exist to override an inference. */
export interface SmartInitOptions {
  /**
   * Gravitational acceleration to use, m/s². Defaults to the magnitude the
   * problem's own environment reports at the launch point — see
   * {@link smartInitialAim}.
   */
  readonly gravity?: number;
  /**
   * The point on the target to aim at, in the layout's axis order. Defaults to
   * the target's `center`.
   *
   * The default is the right one for a {@link PointTarget}, where the centre
   * *is* the target, and a deliberate choice for the extended shapes: the
   * centre of a ring or a platform is the point furthest inside it, so an aim
   * that lands there survives the most perturbation before scoring a miss. A
   * caller with a reason to prefer a rim — a grazing shot, a scoring ring's
   * outer band — passes it here rather than reshaping the target.
   */
  readonly aimPoint?: readonly number[];
}

/**
 * {@link dragFreeAim} applied to a {@link ShootingProblem}: reads the launch
 * point, the target and the local gravity off the problem and returns the aim
 * to hand `newtonShooting` as its `initialAim`.
 *
 * **Gravity is sampled from the problem's own environment, not assumed.** The
 * scenario library ships an entry with altitude-dependent gravity (P4.02), and
 * an initializer that hard-coded `G_STD` would silently misjudge it. The sample
 * is taken at the launch point and at `tspan[0]`, into a *fresh* `EnvSample`
 * rather than the context's own `env` buffer: that buffer is the rhs hot path's
 * scratch space (ADR-004), and this function has no business writing to it.
 *
 * **Only the downrange axis of the displacement is used.** An aim is two
 * numbers and {@link Aim} spends them on elevation and speed, so
 * `createShootingResidual` launches in the plane spanned by the vertical axis
 * and the first horizontal one. On a spatial layout a target with a lateral
 * offset is therefore unreachable *by construction*, and that offset is an
 * irreducible component of the residual, not something the initial guess can
 * anticipate. Folding it into the horizontal distance would only make the
 * reachable part of the aim worse. Azimuth is a third control variable and
 * belongs to whatever task introduces it.
 */
export function smartInitialAim(problem: ShootingProblem, options: SmartInitOptions = {}): Aim {
  const layout = problem.layout ?? PLANAR_LAYOUT;
  const dim = layout.position.length;

  const launchPoint = problem.launchPoint ?? layout.position.map(() => 0);
  requireLength(launchPoint, dim, "launchPoint");
  const aimPoint = options.aimPoint ?? problem.target.center;
  requireLength(aimPoint, dim, "aimPoint");

  const verticalAxis = layout.vertical;
  const downrangeAxis = downrangeAxisOf(layout);
  const downrange = aimPoint[downrangeAxis]! - launchPoint[downrangeAxis]!;
  const rise = aimPoint[verticalAxis]! - launchPoint[verticalAxis]!;

  const gravity = options.gravity ?? sampleGravity(problem, launchPoint, layout);
  return dragFreeAim(downrange, rise, gravity);
}

/** Local gravity magnitude at the launch point, from the problem's environment. */
function sampleGravity(
  problem: ShootingProblem,
  launchPoint: readonly number[],
  layout: TrajectoryLayout,
): number {
  const sample = new EnvSample();
  const t0 = problem.tspan?.[0] ?? 0;
  const worldX = launchPoint[downrangeAxisOf(layout)]!;
  const worldY = launchPoint[layout.vertical]!;
  problem.ctx.environment.sample(t0, worldX, worldY, sample);
  if (!Number.isFinite(sample.g) || !(sample.g > 0)) {
    throw new Error(
      `smartInitialAim: the environment reports g = ${sample.g} at the launch point, which is ` +
        "not a gravity a ballistic aim can be formed from; pass `gravity` explicitly if the " +
        "problem is meant to run without it",
    );
  }
  return sample.g;
}

function requireFinite(value: number, what: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`dragFreeAim: ${what} must be finite; got ${value}`);
  }
}

function requireLength(value: readonly number[], expected: number, what: string): void {
  if (value.length !== expected) {
    throw new Error(
      `smartInitialAim: ${what} has ${value.length} component(s); the layout expects ${expected}`,
    );
  }
  for (let axis = 0; axis < expected; axis++) {
    if (!Number.isFinite(value[axis]!)) {
      throw new Error(`smartInitialAim: ${what}[${axis}] must be finite; got ${value[axis]}`);
    }
  }
}
