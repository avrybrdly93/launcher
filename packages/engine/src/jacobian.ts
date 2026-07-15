import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

const DRAG_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy (row-major, out[row*4+col]) for the planar
 * gravity + quadratic-drag RHS (eq. 3.18 with Magnus/buoyancy omitted —
 * buoyancy contributes zero to J regardless since it is state-independent,
 * but Magnus's C_L(S) term is not differentiated here). Derivation: with
 * u = v - w, u = |u|, k = rho*Cd*A/(2m) held fixed at the sampled point,
 *
 *   d(ax)/d(vx) = -k*(u + ux^2/u)   d(ax)/d(vy) = -k*ux*uy/u
 *   d(ay)/d(vx) = -k*ux*uy/u        d(ay)/d(vy) = -k*(u + uy^2/u)
 *
 * This is *exact* only when rho, Cd, and wind are independent of state at
 * the evaluated point — i.e. ConstantAtmosphere, non-altitude-dependent
 * UniformGravity, ConstantCd, and Zero/uniform wind (P1.23 generalizes via
 * finite differences once those dependencies are introduced). At u=0 the
 * drag block is the zero matrix: u*u_i is C1 but not C2 there (Sec. 3.8), and
 * every term above vanishes in the limit since |u_i| <= u.
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

    const re = env.eta > 0 ? (env.rho * u * (2 * params.radius)) / env.eta : 0;
    const mach = env.c > 0 ? u / env.c : 0;
    const cd = params.dragCoefficient.cd(re, mach);
    const k = (env.rho * cd * params.area) / (2 * params.mass);

    out.fill(0);
    out[X * DIM + VX] = 1;
    out[Y * DIM + VY] = 1;

    if (u < DRAG_SPEED_EPS) {
      return;
    }

    const dAxDvx = -k * (u + (ux * ux) / u);
    const dAxDvy = -k * ((ux * uy) / u);
    const dAyDvy = -k * (u + (uy * uy) / u);

    out[VX * DIM + VX] = dAxDvx;
    out[VX * DIM + VY] = dAxDvy;
    out[VY * DIM + VX] = dAxDvy;
    out[VY * DIM + VY] = dAyDvy;
  };
}
