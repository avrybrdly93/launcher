import { spinParameter } from "./characteristic-scales.js";
import type { EvalContext } from "./eval-context.js";
import type { ProjectileParams } from "./projectile-params.js";
import type { MutVec2 } from "./vec2.js";

/**
 * One term of the force composition (3.2). `accumulate` *adds* into
 * `outForce` — it never zeroes or overwrites it — so composeForces can sum
 * an arbitrary set of forces into one preallocated buffer (§2.4a).
 */
export interface ForceModel {
  readonly id: string;
  /** Adds this force's contribution at (t, y) into `outForce` (does not zero it first). */
  accumulate(t: number, y: Float64Array, ctx: EvalContext, outForce: MutVec2): void;
  /** Instantaneous power this force delivers, F.v using the true velocity (eq. 3.19). */
  energyPower?(t: number, y: Float64Array, ctx: EvalContext): number;
}

const VX = 2;
const VY = 3;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }
}

/** Stokes drag F = -b*v_rel, b = 6*pi*eta*R, valid for Re << 1 (eq. 3.5). */
export class LinearDragForce implements ForceModel {
  readonly id = "drag-linear";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    outForce[0] += -b * ctx.vRel[0];
    outForce[1] += -b * ctx.vRel[1];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const b = 6 * Math.PI * ctx.env.eta * ctx.params.radius;
    return -b * (ctx.vRel[0] * y[VX]! + ctx.vRel[1] * y[VY]!);
  }
}

/**
 * Quadratic (Newtonian) drag F = -0.5*rho*Cd*A*|v_rel|*v_rel (eq. 3.8).
 * At v_rel = 0 this evaluates to exactly zero — no division, so no NaN guard
 * is needed beyond ensuring the Cd model itself stays finite at Re=0 (P1.09).
 */
export class QuadraticDragForce implements ForceModel {
  readonly id = "drag-quadratic";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    outForce[0] += -k * ctx.vRel[0];
    outForce[1] += -k * ctx.vRel[1];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area * ctx.speedRel;
    return -k * (ctx.vRel[0] * y[VX]! + ctx.vRel[1] * y[VY]!);
  }
}

/**
 * Magnus lift force (eq. 3.15, 2D-specialized form). Spin is a constant
 * scalar on `params.spin`; the spin-ratio S = |omega|*R/|v_rel| ({@link
 * spinParameter}) is clamped to 0 as |v_rel| -> 0 (P1.15) rather than left
 * to divide by zero — the force already vanishes there via the |v_rel|
 * factor, so the clamp only prevents a spurious 0/0 = NaN when both spin
 * and speed are exactly zero.
 */
export class MagnusForce implements ForceModel {
  readonly id = "magnus";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return;

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    // ê_z x v_rel = (-v_rel_y, v_rel_x)
    outForce[0] += -k * ctx.vRel[1];
    outForce[1] += k * ctx.vRel[0];
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return 0;

    const spinRatio = spinParameter(omega, ctx.params.radius, ctx.speedRel);
    const cl = liftModel.cl(spinRatio);
    const k = 0.5 * ctx.env.rho * cl * ctx.params.area * ctx.speedRel * Math.sign(omega);
    const fx = -k * ctx.vRel[1];
    const fy = k * ctx.vRel[0];
    return fx * y[VX]! + fy * y[VY]!;
  }
}

/** F_b = rho*V*g upward (§3.4); typically ~1% of weight, toggled per-scenario. */
export class BuoyancyForce implements ForceModel {
  readonly id = "buoyancy";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += ctx.env.rho * ctx.params.volume * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return ctx.env.rho * ctx.params.volume * ctx.env.g * y[VY]!;
  }
}

/**
 * Coriolis pseudo-force, F = -2m*Omega x v (P4.27). Genuinely 3D: written out
 * in the (downrange=x, up=y, lateral=z) axes this model uses, with Omega at
 * latitude phi expressed as (Omega*cos(phi), Omega*sin(phi), 0) -- the
 * standard ENU decomposition (zero East component, cos(phi) component along
 * the local North/downrange direction, sin(phi) component along local
 * Up/vertical) -- its dominant term for a vertical drop is exactly the
 * lateral (z) component, which a 2D model has no channel to receive. See
 * `spatial-projectile-model.ts`'s "coriolis" switch case for the actual 3D
 * force law and the derivation of why that reduces to the classic
 * eastward-deflection formula; this class exists only as a registry id
 * marker there (same role `GravityForce`/`QuadraticDragForce` already play
 * when passed to `createSpatialProjectileModel`). `accumulate` throws rather
 * than silently omitting the one component that is this force's entire
 * point, matching `createSpatialProjectileModel`'s own "throw rather than
 * silently produce wrong physics" policy for unsupported force ids.
 */
export class CoriolisForce implements ForceModel {
  readonly id = "coriolis";

  /** @inheritDoc */
  accumulate(_t: number, _y: Float64Array, _ctx: EvalContext, _outForce: MutVec2): void {
    throw new Error(
      "CoriolisForce is 3D-only (createSpatialProjectileModel): its dominant deflection " +
        "component is lateral (z), which a 2D model has no channel to receive.",
    );
  }
}

/**
 * |F_b|/|F_g| = rho_air*V / m -- g cancels, so this is a pure property of
 * the projectile and the local air density, independent of any gravity
 * model (uniform or altitude-dependent). This is the one live number the
 * P4.20 "how big are the effects we ignore?" exercise (§3.4, §5.5 worked
 * example 1) needs: buoyancy is a real, small, toggleable force (already
 * wired end-to-end via `BuoyancyForce` above, P1.16), and this ratio is what
 * "small" means quantitatively for a given preset.
 */
export function buoyancyToWeightRatio(params: ProjectileParams, rhoAir: number): number {
  return (rhoAir * params.volume) / params.mass;
}

/**
 * Sorts forces by id for deterministic accumulation order, independent of
 * registration order (P1.17). Floating-point addition is order-dependent at
 * the ULP level, so fixing the order is what makes rhs bit-reproducible.
 */
export function createForceRegistry(forces: readonly ForceModel[]): readonly ForceModel[] {
  return [...forces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Sums each force's declared power F_i . v_true (0 for a force with no
 * `energyPower`), in registry order — the per-force half of the energy
 * bookkeeping (3.19). Combined with gravity's own -mg*v_y term this
 * reconstructs dE/dt for the mechanical energy E = (1/2)m|v|^2 + mgy: the
 * two cancel exactly whenever gravity is in `forces`, leaving only the
 * remaining (aero) forces' contribution.
 */
export function totalForcePower(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
): number {
  let power = 0;
  for (const force of forces) {
    power += force.energyPower?.(t, y, ctx) ?? 0;
  }
  return power;
}

/** Zeroes `outForce` then accumulates every force in `forces`, in registry order. */
export function composeForces(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outForce: MutVec2,
): void {
  outForce[0] = 0;
  outForce[1] = 0;
  for (const force of forces) {
    force.accumulate(t, y, ctx, outForce);
  }
}

/** A force-set-specialized {@link composeForces}, bound to one registry. */
export type ComposedForces = (
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outForce: MutVec2,
) => void;

/**
 * Binds `forces` into a closure whose `accumulate` calls sit at **separate**
 * call sites (P7.04, §7 phase-7 table: "JIT-friendliness pass: monomorphic
 * call sites, no megamorphic force dispatch in batch").
 *
 * ## The problem this exists to solve, and the measurement that found it
 *
 * {@link composeForces} has **one** `force.accumulate(...)` call site, and
 * every force in the program goes through it. V8's inline cache holds four
 * maps; the fifth makes the site megamorphic, and a megamorphic site is not
 * inlined and dispatches through a hash lookup. Six classes implement
 * {@link ForceModel}, and `scenario-resolver.ts` exposes five of them for
 * planar scenarios — so a scenario that enables all five lands past the cliff.
 *
 * It is a cliff, not a slope, and `scripts/measure-force-dispatch.mjs`
 * (`pnpm bench:dispatch`) re-derives it in one command. Holding the arithmetic
 * and the call count fixed and varying only the number of distinct classes,
 * throughput relative to the one-class case is 1.07, 0.93, 0.82, 0.90 at one
 * to four classes and then **0.168, 0.165, 0.155** at five, six and eight. On
 * the real planar model the rhs runs at 4.10/4.16/3.74/3.17 ×10⁷ calls·s⁻¹
 * for one to four forces and **1.51 ×10⁷** at five.
 *
 * ## Why unrolling fixes it, and the honest limit of the fix
 *
 * Each `fN.accumulate(...)` below is its own call site with its own inline
 * cache, so each sees only the classes that occupy *that position*. For the
 * full five-force planar set there is exactly one such set, so every site sees
 * exactly one map and every site is monomorphic. For smaller sets several
 * subsets share an arity, so a site can see a handful of maps — but four or
 * fewer is polymorphic, which the measurement above shows costs ~10%, not 6×.
 *
 * The honest limit: closures returned from the same `case` share a code
 * object, so these sites are shared across *all* registries of that arity in
 * the process. This converts "one site seeing up to six maps" into "k sites
 * each seeing few", which is a bound, not a guarantee of monomorphism. Beyond
 * {@link UNROLL_LIMIT} it falls back to {@link composeForces} — a force set
 * that large is already past the point where dispatch is the problem.
 *
 * ## Bit-identity
 *
 * The unrolled body performs exactly the accumulations {@link composeForces}
 * performs, on the same accumulator, in the same registry order. Floating-point
 * addition is order-dependent at the ULP level and force order is id-sorted for
 * precisely that reason (P1.17), so this is a structural guarantee rather than
 * a tolerance: `forces-specializer.test.ts` asserts it bit-for-bit, and the
 * golden trajectories are unchanged.
 *
 * @param forces registry order, already sorted — pass {@link createForceRegistry}'s output.
 */
export function specializeForces(forces: readonly ForceModel[]): ComposedForces {
  // Destructured into consts so each call site below binds one captured
  // variable. Indexing `forces[i]` inside the closure would reintroduce a
  // shared load and defeat the point.
  const [f0, f1, f2, f3, f4, f5, f6, f7] = forces;
  switch (forces.length) {
    case 0:
      return (_t, _y, _ctx, out) => {
        out[0] = 0;
        out[1] = 0;
      };
    case 1:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
      };
    case 2:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
      };
    case 3:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
      };
    case 4:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
        f3!.accumulate(t, y, ctx, out);
      };
    case 5:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
        f3!.accumulate(t, y, ctx, out);
        f4!.accumulate(t, y, ctx, out);
      };
    case 6:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
        f3!.accumulate(t, y, ctx, out);
        f4!.accumulate(t, y, ctx, out);
        f5!.accumulate(t, y, ctx, out);
      };
    case 7:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
        f3!.accumulate(t, y, ctx, out);
        f4!.accumulate(t, y, ctx, out);
        f5!.accumulate(t, y, ctx, out);
        f6!.accumulate(t, y, ctx, out);
      };
    case 8:
      return (t, y, ctx, out) => {
        out[0] = 0;
        out[1] = 0;
        f0!.accumulate(t, y, ctx, out);
        f1!.accumulate(t, y, ctx, out);
        f2!.accumulate(t, y, ctx, out);
        f3!.accumulate(t, y, ctx, out);
        f4!.accumulate(t, y, ctx, out);
        f5!.accumulate(t, y, ctx, out);
        f6!.accumulate(t, y, ctx, out);
        f7!.accumulate(t, y, ctx, out);
      };
    default:
      return (t, y, ctx, out) => {
        composeForces(forces, t, y, ctx, out);
      };
  }
}

/**
 * Largest force count {@link specializeForces} unrolls. Six classes implement
 * {@link ForceModel} today; the headroom is so that adding one or two does not
 * silently drop every scenario back onto the megamorphic path.
 */
export const UNROLL_LIMIT = 8;

/**
 * P7.05 measured hand fusion of the enabled-force list into one flat function
 * — the force bodies inlined, no `accumulate` call at any arity — and **it is
 * deliberately not here**, because it was measured and rejected rather than
 * skipped.
 *
 * Two candidate implementations were built and both are bit-identical to
 * {@link composeForces}. Neither is faster enough to keep:
 *
 * - a **masked** form (`if (mask & BIT)` per force, one closure for all force
 *   sets) runs at **0.80×** {@link specializeForces} — the mask is a captured
 *   variable, not a compile-time constant, so V8 cannot fold the branches and
 *   the straight-line body P7.04 already produces wins;
 * - an **ideal branchless** form, hand-written for one fixed force set with no
 *   mask at all — the upper bound on what any codegen could emit — runs at
 *   **1.07×**, against a criterion asking **1.5×**.
 *
 * So P7.04 had already taken essentially all of the dispatch win, and what is
 * left above it is ~7% of force composition, itself only part of the rhs.
 * Adopting the masked form would have been a 20% regression in the hot path.
 *
 * Both candidates, the measurement and its reproduction live in
 * `scripts/measure-force-dispatch.mjs` (`pnpm bench:dispatch`, §5–§8). The
 * criterion itself is P0.129's to decide. **Do not re-introduce a fused
 * composer here on the strength of the idea alone — re-run §5 first.**
 */
