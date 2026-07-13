import type { EvalContext } from "./eval-context.js";
import type { ForceModel } from "./forces.js";
import type { Model } from "./model.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const SPEED_EPS = 1e-9;

/**
 * The exact force-id set this analytic Jacobian differentiates (§3.7, eq.
 * 3.18 with the Magnus term dropped). Any other combination (Magnus, or a
 * position/time-varying environment) falls back to the generic
 * finite-difference Jacobian (P1.23) instead.
 */
const SUPPORTED_FORCE_IDS = ["drag-quadratic", "gravity"] as const;

function isExactlyGravityAndQuadraticDrag(forces: readonly ForceModel[]): boolean {
  if (forces.length !== SUPPORTED_FORCE_IDS.length) return false;
  const ids = forces.map((f) => f.id).sort();
  return ids.every((id, i) => id === SUPPORTED_FORCE_IDS[i]);
}

/**
 * Builds the analytic Jacobian J = df/dy for the planar gravity +
 * quadratic-drag model (eq. 3.18, Magnus off), valid when Cd is
 * state-independent and rho/wind/g don't vary with (t, x, y) — the
 * "workhorse" configuration this platform's canonical scenarios use.
 *
 * `out` is row-major DIM x DIM: out[i*DIM+j] = d(f_i)/d(y_j). The x/y rows
 * are exact and trivial (dx/dt = vx, dy/dt = vy, independent of everything);
 * gravity is a state-independent additive term in f_VY so contributes
 * nothing to J. The only nonzero second-order block is
 * d(v_x', v_y')/d(v_x, v_y), derived from F_drag/m = -kd*|u|*u,
 * u = v - w, kd = 0.5*rho*Cd*A/m:
 *
 *   d(u*ux)/dvx = (2ux^2 + uy^2)/u,   d(u*ux)/dvy = d(u*uy)/dvx = ux*uy/u
 *   d(u*uy)/dvy = (2uy^2 + ux^2)/u
 *
 * which has a removable singularity at u=0 (the limit along any direction is
 * 0, matching the C^1-but-not-C^2 kink at v_rel=0 noted in §3.8); the
 * implementation special-cases it rather than dividing by ~0.
 *
 * Returns undefined if `forces` isn't exactly {gravity, quadratic-drag}, so
 * callers can fall back to a finite-difference Jacobian for anything wider.
 */
export function createGravityQuadraticDragJacobian(
  forces: readonly ForceModel[],
): Model["jacobian"] | undefined {
  if (!isExactlyGravityAndQuadraticDrag(forces)) return undefined;

  return (t: number, y: Float64Array, out: Float64Array, ctx: EvalContext): void => {
    const vx = y[VX]!;
    const vy = y[VY]!;

    ctx.environment.sample(t, y[X]!, y[Y]!, ctx.env);
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

    if (u > SPEED_EPS) {
      const cross = (kd * ux * uy) / u;
      out[VX * DIM + VX] = -(kd * (2 * ux * ux + uy * uy)) / u;
      out[VX * DIM + VY] = -cross;
      out[VY * DIM + VX] = -cross;
      out[VY * DIM + VY] = -(kd * (2 * uy * uy + ux * ux)) / u;
    }
  };
}
