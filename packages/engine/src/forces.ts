import type { EvalContext } from "./eval-context.js";
import type { MutVec2 } from "./vec2.js";

/**
 * One term of the force composition (3.2). `accumulate` *adds* into
 * `outForce` — it never zeroes or overwrites it — so composeForces can sum
 * an arbitrary set of forces into one preallocated buffer (§2.4a).
 */
export interface ForceModel {
  readonly id: string;
  accumulate(t: number, y: Float64Array, ctx: EvalContext, outForce: MutVec2): void;
  /** Instantaneous power this force delivers, F.v using the true velocity (eq. 3.19). */
  energyPower?(t: number, y: Float64Array, ctx: EvalContext): number;
  /**
   * ∂F/∂y contribution (P1.22), accumulated additively into `outJ` — a flat
   * 8-element buffer laid out as two rows [dFx/dx, dFx/dy, dFx/dvx, dFx/dvy,
   * dFy/dx, dFy/dy, dFy/dvx, dFy/dvy]. Optional: only forces with a
   * closed-form derivative implement it, and a model exposes an analytic
   * `jacobian` only when every one of its composed forces does (else callers
   * fall back to finite differences, P1.23).
   */
  jacobian?(t: number, y: Float64Array, ctx: EvalContext, outJ: Float64Array): void;
}

const VX = 2;
const VY = 3;

/** F_g = -mg*ŷ (§3.2). */
export class GravityForce implements ForceModel {
  readonly id = "gravity";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += -ctx.params.mass * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return -ctx.params.mass * ctx.env.g * y[VY]!;
  }

  /** F_g = -mg*ŷ is independent of state under uniform (non-altitude-dependent) gravity: zero contribution. */
  jacobian(_t: number, _y: Float64Array, _ctx: EvalContext, _outJ: Float64Array): void {
    // no-op: all eight partials are zero
  }
}

/** Stokes drag F = -b*v_rel, b = 6*pi*eta*R, valid for Re << 1 (eq. 3.5). */
export class LinearDragForce implements ForceModel {
  readonly id = "drag-linear";

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

  /**
   * ∂F/∂v of F = -k*u*u_vec (k = 0.5*rho*Cd*A frozen at the evaluation
   * point — Cd's own dependence on Re/Mach is not differentiated, matching
   * the linearization the blueprint uses for the Euler stability estimate,
   * §4.6). With u = |u_vec|, d(u*u_x)/dv_x = u + u_x^2/u and
   * d(u*u_x)/dv_y = u_x*u_y/u (symmetric in x/y); position and wind partials
   * are zero for the currently-implemented spatially-uniform environment
   * models. At u_vec = 0, F is C^1 with a zero gradient there (§3.8), so all
   * four partials vanish rather than dividing by zero.
   */
  jacobian(_t: number, _y: Float64Array, ctx: EvalContext, outJ: Float64Array): void {
    const u = ctx.speedRel;
    if (u < QUADRATIC_DRAG_JACOBIAN_SPEED_EPS) return;

    const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
    const k = 0.5 * ctx.env.rho * cd * ctx.params.area;
    const ux = ctx.vRel[0];
    const uy = ctx.vRel[1];
    const invU = 1 / u;

    const dFx_dvx = -k * (u + ux * ux * invU);
    const dFx_dvy = -k * ux * uy * invU;
    const dFy_dvy = -k * (u + uy * uy * invU);

    outJ[2] = outJ[2]! + dFx_dvx;
    outJ[3] = outJ[3]! + dFx_dvy;
    outJ[6] = outJ[6]! + dFx_dvy;
    outJ[7] = outJ[7]! + dFy_dvy;
  }
}

const QUADRATIC_DRAG_JACOBIAN_SPEED_EPS = 1e-9;

const MAGNUS_SPEED_EPS = 1e-9;

/**
 * Magnus lift force (eq. 3.15, 2D-specialized form). Spin is a constant
 * scalar on `params.spin`; the spin-ratio S = |omega|*R/|v_rel| is clamped
 * to 0 as |v_rel| -> 0 (P1.15) rather than left to divide by zero — the
 * force already vanishes there via the |v_rel| factor, so the clamp only
 * prevents a spurious 0/0 = NaN when both spin and speed are exactly zero.
 */
export class MagnusForce implements ForceModel {
  readonly id = "magnus";

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    const omega = ctx.params.spin;
    const liftModel = ctx.params.liftCoefficient;
    if (!omega || !liftModel) return;

    const spinRatio =
      ctx.speedRel < MAGNUS_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
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

    const spinRatio =
      ctx.speedRel < MAGNUS_SPEED_EPS ? 0 : (Math.abs(omega) * ctx.params.radius) / ctx.speedRel;
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

  accumulate(_t: number, _y: Float64Array, ctx: EvalContext, outForce: MutVec2): void {
    outForce[1] += ctx.env.rho * ctx.params.volume * ctx.env.g;
  }

  energyPower(_t: number, y: Float64Array, ctx: EvalContext): number {
    return ctx.env.rho * ctx.params.volume * ctx.env.g * y[VY]!;
  }
}

/**
 * Sorts forces by id for deterministic accumulation order, independent of
 * registration order (P1.17). Floating-point addition is order-dependent at
 * the ULP level, so fixing the order is what makes rhs bit-reproducible.
 */
export function createForceRegistry(forces: readonly ForceModel[]): readonly ForceModel[] {
  return [...forces].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
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

/** True only when every force in the registry supplies an analytic `jacobian` (P1.22). */
export function jacobianAvailable(forces: readonly ForceModel[]): boolean {
  return forces.every((force) => typeof force.jacobian === "function");
}

/**
 * Zeroes `outJ` then accumulates every force's ∂F/∂y contribution, in
 * registry order. `outJ` is the flat 8-element [dFx/*, dFy/*] layout
 * documented on `ForceModel.jacobian`. Caller must check
 * `jacobianAvailable(forces)` first — forces without a `jacobian` are
 * silently skipped otherwise, which would understate the true derivative.
 */
export function composeJacobian(
  forces: readonly ForceModel[],
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  outJ: Float64Array,
): void {
  outJ.fill(0);
  for (const force of forces) {
    force.jacobian?.(t, y, ctx, outJ);
  }
}
