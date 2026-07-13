import type { EvalContext } from "./eval-context.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const DRAG_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = ∂f/∂y of the planar projectile rhs (3.17-3.18)
 * restricted to gravity + quadratic drag (P1.22) — Magnus and buoyancy are
 * out of scope by task design (buoyancy contributes nothing here regardless:
 * like gravity, it is constant in y). `out` is row-major length dim*dim:
 * `out[row*DIM+col]` = ∂f_row/∂y_col.
 *
 * Environment (ρ, g, wind) is resampled at the queried (t, x, y) exactly as
 * `rhs` does, but its *spatial* gradient is not differentiated through —
 * ∂ρ/∂y, ∂g/∂y, ∂w/∂r are treated as zero. This is exact for the platform's
 * default configuration (constant atmosphere, non-altitude-dependent gravity,
 * position-invariant wind) and a documented approximation otherwise,
 * consistent with §3.3 framing the altitude correction as negligible.
 * Likewise Cd(Re, M) is evaluated but not differentiated w.r.t. Re/M — exact
 * for `ConstantCd`, approximate for speed-dependent drag models.
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
  const kd = (0.5 * ctx.env.rho * cd * ctx.params.area) / ctx.params.mass;

  out.fill(0, 0, DIM * DIM);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  if (u < DRAG_SPEED_EPS) {
    // Drag Jacobian block -> 0 smoothly as v_rel -> 0 (homogeneous degree 1
    // in v_rel near the origin, same kink documented for the force itself
    // in §3.8), avoiding a spurious 0/0 below.
    return;
  }

  const dAxDvx = -kd * (u + (ux * ux) / u);
  const dAxDvy = -kd * ((ux * uy) / u);
  const dAyDvy = -kd * (u + (uy * uy) / u);

  out[VX * DIM + VX] = dAxDvx;
  out[VX * DIM + VY] = dAxDvy;
  out[VY * DIM + VX] = dAxDvy; // symmetric: d(ax)/d(vy) == d(ay)/d(vx)
  out[VY * DIM + VY] = dAyDvy;
}
