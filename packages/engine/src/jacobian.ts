import type { EvalContext } from "./eval-context.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/** Below this relative speed the drag block's contribution is treated as exactly zero (see below). */
const DRAG_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = ∂f/∂y (row-major DIM×DIM: `outJ[i*DIM+j] = ∂f_i/∂y_j`)
 * for the gravity + quadratic-drag-only planar model — eq. (3.18) with the
 * Magnus terms dropped (P1.22).
 *
 * Scope: exact when the environment has zero spatial gradient at (x, y) —
 * `ConstantAtmosphere`, non-altitude-dependent `UniformGravity`, and a wind
 * field uniform in space (the platform's default scenario configuration).
 * Under that assumption f doesn't depend on (x, y) at all, so the x/y
 * columns are zero and the only nonzero block is velocity-on-velocity —
 * exactly the drag-relaxation linearization the Solver Lab's eigenvalue
 * overlay needs (§3.8, τ_drag ~ m/(ρCdAu)). A position-dependent environment
 * needs the P1.23 finite-difference fallback instead.
 *
 * Includes the ∂Cd/∂Re chain-rule term via `DragCoefficientModel.dcdDRe`
 * (falls back to 0, exact for `ConstantCd`) so the result matches central
 * finite differences even through the drag-crisis region of a tabulated
 * Cd(Re) curve.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  outJ: Float64Array,
  ctx: EvalContext,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  ctx.environment.sample(t, x, yPos, ctx.env);
  ctx.vRel[0] = vx - ctx.env.wx;
  ctx.vRel[1] = vy - ctx.env.wy;
  const ux = ctx.vRel[0];
  const uy = ctx.vRel[1];
  const s = norm(ctx.vRel);
  ctx.speedRel = s;

  outJ.fill(0);
  outJ[X * DIM + VX] = 1;
  outJ[Y * DIM + VY] = 1;

  if (s <= DRAG_SPEED_EPS) {
    // u·u is C1 but not C2 at the stagnation point (§3.8); the velocity
    // block's true limit as s -> 0 is exactly zero (k ~ s, and the outer
    // product term is bounded by dkDs*s), so no NaN guard is needed beyond
    // skipping the 0/0 in re/mach below.
    return;
  }

  const re = (ctx.env.rho * s * (2 * ctx.params.radius)) / ctx.env.eta;
  const mach = ctx.env.c > 0 ? s / ctx.env.c : 0;
  ctx.re = re;
  ctx.mach = mach;

  const cd = ctx.params.dragCoefficient.cd(re, mach);
  const dcdDRe = ctx.params.dragCoefficient.dcdDRe?.(re, mach) ?? 0;

  const kCoeff = (0.5 * ctx.env.rho * ctx.params.area) / ctx.params.mass;
  const k = kCoeff * cd * s;
  // d(kCoeff*Cd(re(s),mach(s))*s)/ds, using dRe/ds = re/s and dMach/ds = mach/s
  // (mach's contribution is 0 for every current Cd model, which only varies with Re).
  const dkDs = kCoeff * (cd + re * dcdDRe);

  const rowVx = VX * DIM;
  const rowVy = VY * DIM;
  outJ[rowVx + VX] = -k - (dkDs * ux * ux) / s;
  outJ[rowVx + VY] = -(dkDs * ux * uy) / s;
  outJ[rowVy + VX] = -(dkDs * uy * ux) / s;
  outJ[rowVy + VY] = -k - (dkDs * uy * uy) / s;
}
