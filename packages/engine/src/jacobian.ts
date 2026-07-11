import type { EvalContext } from "./eval-context.js";
import type { Model } from "./model.js";

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

/** Relative step, dimensionless. Central differences have O(h^2) truncation error and
 * O(eps/h) roundoff error; (3*eps)^(1/3) balances the two (§4.1). */
const DEFAULT_RELATIVE_STEP = 1e-5;
/**
 * Floor on the *scale* used to size the step (`h_j = relativeStep * max(stepFloor, |y_j|)`),
 * not on the step itself — keeps the absolute step from collapsing toward zero (and roundoff
 * from dominating) when a state component is itself near zero.
 */
const DEFAULT_STEP_FLOOR = 1;

/**
 * Generic central-difference Jacobian (P1.23), the fallback for any Model
 * whose rhs has no analytic `jacobian` (e.g. Magnus present, or a
 * Re/Mach-dependent Cd — cases the P1.22 closed form doesn't cover). Steps
 * are scaled per component, `h_j = relativeStep * max(stepFloor, |y_j|)`,
 * so it stays well-conditioned across the platform's very different state
 * magnitudes (positions in meters vs. velocities in tens of m/s).
 */
export function finiteDifferenceJacobian(
  model: Pick<Model, "dim" | "rhs">,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
  relativeStep = DEFAULT_RELATIVE_STEP,
  stepFloor = DEFAULT_STEP_FLOOR,
): void {
  const dim = model.dim;
  const yPerturbed = new Float64Array(y);
  const fPlus = new Float64Array(dim);
  const fMinus = new Float64Array(dim);

  for (let j = 0; j < dim; j++) {
    const original = y[j]!;
    const step = relativeStep * Math.max(stepFloor, Math.abs(original));

    yPerturbed[j] = original + step;
    model.rhs(t, yPerturbed, fPlus, ctx);
    yPerturbed[j] = original - step;
    model.rhs(t, yPerturbed, fMinus, ctx);
    yPerturbed[j] = original;

    const inv2h = 1 / (2 * step);
    for (let i = 0; i < dim; i++) {
      out[i * dim + j] = (fPlus[i]! - fMinus[i]!) * inv2h;
    }
  }
}

/** Evaluates the analytic Jacobian if the model declares one, else falls back to P1.23's FD. */
export function modelJacobian(
  model: Model,
  t: number,
  y: Float64Array,
  ctx: EvalContext,
  out: Float64Array,
): void {
  if (model.jacobian) {
    model.jacobian(t, y, out, ctx);
  } else {
    finiteDifferenceJacobian(model, t, y, ctx, out);
  }
}
