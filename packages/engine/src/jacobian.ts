import { EnvSample } from "./env-sample.js";
import type { Environment } from "./environment.js";
import type { ProjectileParams } from "./projectile-params.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;
const DIM = 4;

/**
 * Below this relative-speed the drag partials are treated as exactly zero
 * rather than evaluating the 0/0 the raw formula produces at u_rel=0 — the
 * same smooth-vanishing limit the drag force itself has (P1.09), just
 * applied to its derivative.
 */
const DRAG_JACOBIAN_SPEED_EPS = 1e-9;

/**
 * Analytic Jacobian J = df/dy for the planar projectile rhs (3.17-3.18)
 * restricted to gravity + quadratic drag (3.8) — no Magnus, no buoyancy.
 * `out` is row-major: `out[i*4+j] = df_i/dy_j`.
 *
 * Two simplifications are exact for the platform's default configuration
 * and approximate otherwise:
 *
 *  - Position derivatives (columns/rows X, Y) are zero. Exact whenever
 *    density, gravity, and wind don't vary with (x,y) — true for
 *    `ConstantAtmosphere` + `UniformGravity(altitudeDependent=false)` +
 *    `ZeroWind`/uniform wind, the default env stack. Altitude-dependent
 *    gravity, exponential atmosphere, or spatially-varying wind fields need
 *    the finite-difference fallback (P1.23) instead.
 *  - Cd is evaluated at the state's (Re, Mach) but held fixed while
 *    differentiating w.r.t. velocity (dCd/dRe treated as 0): exact for
 *    `ConstantCd`, an approximation for Re-dependent models such as
 *    `TabulatedReynoldsCd`.
 */
export function gravityQuadraticDragJacobian(
  t: number,
  y: Float64Array,
  out: Float64Array,
  params: ProjectileParams,
  environment: Environment,
  env: EnvSample,
): void {
  const x = y[X]!;
  const yPos = y[Y]!;
  const vx = y[VX]!;
  const vy = y[VY]!;

  environment.sample(t, x, yPos, env);

  out.fill(0, 0, DIM * DIM);
  out[X * DIM + VX] = 1;
  out[Y * DIM + VY] = 1;

  const ux = vx - env.wx;
  const uy = vy - env.wy;
  const speed = Math.hypot(ux, uy);
  if (speed < DRAG_JACOBIAN_SPEED_EPS) return;

  const re = (env.rho * speed * (2 * params.radius)) / env.eta;
  const mach = env.c > 0 ? speed / env.c : 0;
  const cd = params.dragCoefficient.cd(re, mach);
  // F_drag = -k1*u, k1 = C*speed; d(k1*ux)/dv works out to k = C/speed times
  // the terms below (see P1.22 derivation notes in the design doc).
  const k = (0.5 * env.rho * cd * params.area) / speed;

  const dFxDvx = -k * (ux * ux + speed * speed);
  const dFxDvy = -k * ux * uy;
  const dFyDvy = -k * (uy * uy + speed * speed);

  out[VX * DIM + VX] = dFxDvx / params.mass;
  out[VX * DIM + VY] = dFxDvy / params.mass;
  out[VY * DIM + VX] = dFxDvy / params.mass;
  out[VY * DIM + VY] = dFyDvy / params.mass;
}

/**
 * Binds `gravityQuadraticDragJacobian` to a fixed environment/params pair as
 * a `Model.jacobian`-shaped closure, with its own preallocated `EnvSample` so
 * repeated calls stay allocation-free (ADR-004).
 */
export function createGravityQuadraticDragJacobian(
  environment: Environment,
  params: ProjectileParams,
): (t: number, y: Float64Array, out: Float64Array) => void {
  const env = new EnvSample();
  return (t: number, y: Float64Array, out: Float64Array): void => {
    gravityQuadraticDragJacobian(t, y, out, params, environment, env);
  };
}
