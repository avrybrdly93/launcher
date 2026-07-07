import type { EvalContext } from "./eval-context.js";
import type { DragCoefficientModel } from "./drag-coefficient.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

const SPEED_EPS = 1e-9;

/**
 * dCd/dRe at the current flow state. Uses the model's analytic derivative
 * when available (P1.11's PCHIP table exposes one in closed form); otherwise
 * falls back to a scaled central difference of `cd` itself — cheap since
 * this only runs inside Jacobian evaluation, never on the rhs hot path.
 */
function dCdDRe(model: DragCoefficientModel, re: number, mach: number): number {
  if (model.dcdDre) return model.dcdDre(re, mach);
  const h = Math.max(1, Math.abs(re)) * 1e-6;
  return (model.cd(re + h, mach) - model.cd(re - h, mach)) / (2 * h);
}

/**
 * Analytic J = ∂f/∂y for the gravity + quadratic-drag-only planar model
 * (P1.22; eq. 3.18 with the Magnus term absent). Valid under the same
 * scope as `createPlanarProjectileModel`'s default wiring: environment
 * fields (ρ, η, g, wind) are treated as independent of position — true for
 * the constant-atmosphere / uniform-gravity / uniform-wind configuration.
 * Position-dependent environments (exponential atmosphere, sheared wind,
 * altitude-dependent gravity) are out of scope here and must use the
 * generic finite-difference Jacobian (P1.23) instead.
 *
 * Derivation: with u = v - w, s = |u|, K = ρA/(2m), and g(s) = Cd(s)·s,
 * the drag acceleration is a = -K·g(s)·u, so
 *   ∂a_x/∂v_x = -K·[g'(s)·u_x²/s + g(s)],  ∂a_x/∂v_y = -K·g'(s)·u_x·u_y/s
 *   ∂a_y/∂v_x = -K·g'(s)·u_x·u_y/s,        ∂a_y/∂v_y = -K·[g'(s)·u_y²/s + g(s)]
 * with g'(s) = Cd'(s)·s + Cd(s) and Cd'(s) = dCd/dRe · dRe/ds, dRe/ds = ρ·2R/η.
 * Gravity contributes nothing (constant force). `out` is row-major 4x4:
 * out[4*i+j] = ∂f_i/∂y_j.
 */
export function analyticGravityQuadraticDragJacobian(
  _t: number,
  y: Float64Array,
  out: Float64Array,
  ctx: EvalContext,
): void {
  out.fill(0);
  out[4 * X + VX] = 1;
  out[4 * Y + VY] = 1;

  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const s = ctx.speedRel;
  const cd = ctx.params.dragCoefficient.cd(ctx.re, ctx.mach);
  const K = (ctx.env.rho * ctx.params.area) / (2 * ctx.params.mass);

  let dAxDvx: number;
  let dAxDvy: number;
  let dAyDvy: number;

  if (s < SPEED_EPS) {
    dAxDvx = -K * cd * s;
    dAxDvy = 0;
    dAyDvy = -K * cd * s;
  } else {
    const dRedS = (ctx.env.rho * 2 * ctx.params.radius) / ctx.env.eta;
    const cdPrime = dCdDRe(ctx.params.dragCoefficient, ctx.re, ctx.mach) * dRedS;
    const gPrime = cdPrime * s + cd;
    const g = cd * s;
    dAxDvx = -K * (gPrime * ((ux * ux) / s) + g);
    dAxDvy = -K * gPrime * ((ux * uy) / s);
    dAyDvy = -K * (gPrime * ((uy * uy) / s) + g);
  }

  out[4 * VX + VX] = dAxDvx;
  out[4 * VX + VY] = dAxDvy;
  out[4 * VY + VX] = dAxDvy; // symmetric: ∂a_y/∂v_x = ∂a_x/∂v_y
  out[4 * VY + VY] = dAyDvy;
}
