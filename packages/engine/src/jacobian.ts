import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/** |v_rel| below which the drag Jacobian is taken as its (zero) limit rather than evaluated directly (avoids 0/0). */
const SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (row-major, `out[row*DIM+col] = d f_row / d y_col`)
 * for the planar projectile under gravity + quadratic drag only (eq. 3.17-3.18
 * with Magnus, linear drag, and buoyancy all absent) — P1.22.
 *
 * Exact only under the assumptions this restricted force set makes available
 * by default: rho, Cd, g, and wind are constant along the trajectory (no
 * altitude-dependent gravity/atmosphere, no Cd(Re) dependence, no spatially
 * varying wind). Position derivatives are then identically zero, and with
 * u_rel = v - w, u = |u_rel|, k_d = rho*Cd*A/(2m):
 *
 *   d(ax)/dvx = -k_d*(ux^2 + u^2)/u,   d(ax)/dvy = -k_d*ux*uy/u
 *   d(ay)/dvx = -k_d*ux*uy/u,          d(ay)/dvy = -k_d*(uy^2 + u^2)/u
 *
 * A model whose Cd or environment breaks those assumptions (TabulatedReynoldsCd,
 * altitude-dependent gravity/atmosphere, non-uniform wind) must use the
 * generic finite-difference Jacobian (P1.23) instead.
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
    const cd = params.dragCoefficient.cd(0, 0);
    const kd = (env.rho * cd * params.area) / (2 * params.mass);

    out.fill(0, 0, DIM * DIM);
    out[X * DIM + VX] = 1;
    out[Y * DIM + VY] = 1;

    if (u >= SPEED_EPS) {
      out[VX * DIM + VX] = (-kd * (ux * ux + u * u)) / u;
      out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
      out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
      out[VY * DIM + VY] = (-kd * (uy * uy + u * u)) / u;
    }
  };
}
