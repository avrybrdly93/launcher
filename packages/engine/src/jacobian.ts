import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic Jacobian J = ∂f/∂y (row-major, dim*dim) for the planar
 * gravity + quadratic-drag rhs (eq. 3.18 restricted to those two forces,
 * P1.22). Closed form: with u = v_rel = v - w(t,r), kappa = 0.5*rho*Cd*A/m,
 * F_drag/m = -kappa*|u|*u gives ∂(F_drag/m)_i/∂u_j = -kappa*(|u|*delta_ij +
 * u_i*u_j/|u|), which -> 0 as |u| -> 0 (the force is C1 but not C2 there,
 * §3.8); gravity contributes an exact zero block (it does not depend on y).
 *
 * Exact only when rho, g, Cd, and w are locally constant in state — true
 * for the platform default ConstantAtmosphere + non-altitude UniformGravity
 * + ZeroWind/uniform-wind + ConstantCd combination. Position-dependent wind,
 * altitude-dependent g, or Re/Mach-dependent Cd all introduce terms this
 * closed form omits; those cases need the finite-difference fallback (P1.23).
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  const ux = vx - ctx.env.wx;
  const uy = vy - ctx.env.wy;
  const u = Math.hypot(ux, uy);
  const re = (ctx.env.rho * u * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? u / ctx.env.c : 0;
  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const kappa = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0, 0, DIM * DIM);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u > 0) {
    out[VX * DIM + VX] = -kappa * (u + (ux * ux) / u);
    out[VX * DIM + VY] = -kappa * ((ux * uy) / u);
    out[VY * DIM + VX] = -kappa * ((uy * ux) / u);
    out[VY * DIM + VY] = -kappa * (u + (uy * uy) / u);
  }
}

/** Force ids whose Jacobian contribution to (3.18) is exactly the zero block (P1.22). */
const ZERO_JACOBIAN_FORCE_IDS = new Set(["gravity", "buoyancy"]);

/**
 * True when every force in the registry is covered by the closed form above
 * (gravity/buoyancy, whose Jacobian is identically zero, plus quadratic
 * drag) — the guard `createPlanarProjectileModel` uses to decide whether to
 * wire up the analytic Jacobian or leave it unset for the FD fallback.
 */
export function supportsGravityQuadraticDragJacobian(forceIds: readonly string[]): boolean {
  return (
    forceIds.includes("drag-quadratic") &&
    forceIds.every((id) => ZERO_JACOBIAN_FORCE_IDS.has(id) || id === "drag-quadratic")
  );
}
