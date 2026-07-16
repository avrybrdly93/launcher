import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy of the planar projectile rhs (3.17-3.18)
 * restricted to gravity + quadratic drag only (no Magnus, no linear drag, no
 * buoyancy). `out` is the row-major-flattened 4x4 matrix:
 * out[i*4+j] = d(f_i)/d(y_j), for y = (x, y, vx, vy).
 *
 * Exact in closed form only when Cd, rho and g are all state-independent
 * (ConstantCd, ConstantAtmosphere, altitude-independent UniformGravity,
 * state-independent wind) — the same configuration P1.08's "constant Cd"
 * quadratic drag targets. With those held, position derivatives are all
 * zero and only the velocity block is nontrivial.
 *
 * As |v_rel| -> 0, every velocity-derivative term has the form u_i*u_j/u,
 * a removable singularity whose limit is exactly 0 (same C^1-not-C^2 kink
 * as the force itself, P1.09/§3.8) — below DRAG_JACOBIAN_SPEED_EPS those
 * entries are left at 0 rather than computed, avoiding a 0/0 NaN.
 */
export function createGravityQuadraticDragJacobian(
  environment: Environment,
  params: ProjectileParams,
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

    out.fill(0);
    out[X * DIM + VX] = 1; // d(dx/dt)/d(vx)
    out[Y * DIM + VY] = 1; // d(dy/dt)/d(vy)

    if (u < DRAG_JACOBIAN_SPEED_EPS) return;

    const re = (env.rho * u * (2 * params.radius)) / env.eta;
    const mach = env.c > 0 ? u / env.c : 0;
    const cd = params.dragCoefficient.cd(re, mach);
    const k = (0.5 * env.rho * cd * params.area) / params.mass;

    out[VX * DIM + VX] = (-k * (ux * ux)) / u - k * u;
    out[VX * DIM + VY] = (-k * (ux * uy)) / u;
    out[VY * DIM + VX] = (-k * (ux * uy)) / u;
    out[VY * DIM + VY] = (-k * (uy * uy)) / u - k * u;
  };
}
