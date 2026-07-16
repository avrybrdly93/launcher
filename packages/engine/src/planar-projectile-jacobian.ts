import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";
import type { MutVec2 } from "./vec2.js";
import { norm } from "./vec2.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Analytic Jacobian J = df/dy (eq. 3.17-3.18) for the planar projectile under
 * gravity + quadratic drag only (no Magnus). `out` is row-major, length
 * dim*dim: `out[row*dim + col]` = d(f_row)/d(y_col), matching `Model.jacobian`.
 *
 * Assumes rho, g, and wind are independent of (t, x, y) — i.e.
 * ConstantAtmosphere + non-altitude UniformGravity + Zero/uniform wind — and
 * that the drag coefficient does not vary with Re/Mach (ConstantCd). A
 * position/time-varying environment or a Re-dependent Cd model (e.g.
 * TabulatedReynoldsCd) introduces extra chain-rule terms this closed form
 * does not compute; such cases need the finite-difference fallback (P1.23).
 */
export function createGravityQuadraticDragJacobian(
  environment: Environment,
  params: ProjectileParams,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const env = new EnvSample();
  const vRel: MutVec2 = [0, 0];

  return function jacobian(t: number, y: Float64Array, out: Float64Array): void {
    const x = y[X]!;
    const yPos = y[Y]!;
    const vx = y[VX]!;
    const vy = y[VY]!;

    environment.sample(t, x, yPos, env);
    vRel[0] = vx - env.wx;
    vRel[1] = vy - env.wy;
    const u = norm(vRel);
    const re = (env.rho * u * (2 * params.radius)) / env.eta;
    const mach = env.c > 0 ? u / env.c : 0;
    const cd = params.dragCoefficient.cd(re, mach);
    const kd = (0.5 * env.rho * cd * params.area) / params.mass;

    out.fill(0);
    out[X * DIM + VX] = 1;
    out[Y * DIM + VY] = 1;

    // d(vx)/dt = -kd*u*ux, d(vy)/dt = -g - kd*u*uy; both -> 0 as u -> 0 (C1
    // but not C2 at v_rel=0, §3.8), so the guard below matches that limit.
    if (u > 0) {
      const ux = vRel[0];
      const uy = vRel[1];
      const u2 = u * u;
      out[VX * DIM + VX] = (-kd * (ux * ux + u2)) / u;
      out[VX * DIM + VY] = (-kd * (ux * uy)) / u;
      out[VY * DIM + VX] = (-kd * (ux * uy)) / u;
      out[VY * DIM + VY] = (-kd * (uy * uy + u2)) / u;
    }
  };
}
