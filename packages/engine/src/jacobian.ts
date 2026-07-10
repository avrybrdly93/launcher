import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/** Below this relative speed, drag's Jacobian contribution is treated as exactly zero. */
const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian ∂f/∂y (row-major, out[i*4+j] = ∂f_i/∂y_j) for the planar
 * projectile under gravity + quadratic drag only — the P1.22 case. With
 * u = v - w, u = |u|, k_d = ρ·C_d·A/(2m) evaluated (and frozen, per the
 * linearization in §4.6) at the current state:
 *
 *   ∂(vx)/∂(x,y,vx,vy) = (0, 0, 1, 0)
 *   ∂(vy)/∂(x,y,vx,vy) = (0, 0, 0, 1)
 *   ∂(v̇x)/∂vx = -k_d(u_x²/u + u),  ∂(v̇x)/∂vy = -k_d·u_x·u_y/u
 *   ∂(v̇y)/∂vx = -k_d·u_x·u_y/u,    ∂(v̇y)/∂vy = -k_d(u_y²/u + u)
 *
 * matching the velocity-block eigenvalues -k_d·u·{1, 1/2} of §4.6 line 527 in
 * the streamwise/crosswise limit. Gravity and drag coefficients are held
 * frozen w.r.t. the state they're sampled at (no dC_d/dRe, dg/dy terms) —
 * exact for `ConstantCd` + non-altitude-dependent gravity + spatially
 * uniform wind, the scope this task covers; P1.23's finite-difference
 * fallback handles the general case (Magnus, tabulated Cd, altitude gravity).
 * At u=0 the true Jacobian is the zero matrix in this block: u·u_x is C¹ but
 * not C² at the origin (§3.8), so the analytic limit removes the 0/0 rather
 * than needing an ad hoc clamp.
 */
export function createGravityQuadraticDragJacobian(
  params: ProjectileParams,
  environment: Environment,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const env = new EnvSample();

  return (t: number, y: Float64Array, out: Float64Array): void => {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;

    environment.sample(t, x, yPos, env);

    const ux = vx - env.wx;
    const uy = vy - env.wy;
    const u = Math.hypot(ux, uy);
    const re = (env.rho * u * (2 * params.radius)) / env.eta;
    const mach = env.c > 0 ? u / env.c : 0;
    const cd = params.dragCoefficient.cd(re, mach);
    const kd = (env.rho * cd * params.area) / (2 * params.mass);

    out.fill(0);
    out[X * DIM + VX] = 1;
    out[Y * DIM + VY] = 1;

    if (u < SPEED_EPS) return;

    out[VX * DIM + VX] = -kd * ((ux * ux) / u + u);
    out[VX * DIM + VY] = (-kd * ux * uy) / u;
    out[VY * DIM + VX] = (-kd * ux * uy) / u;
    out[VY * DIM + VY] = -kd * ((uy * uy) / u + u);
  };
}
