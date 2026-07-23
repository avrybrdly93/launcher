import type { ProjectileParams } from "./projectile-params.js";
import { G_STD } from "./units.js";

/**
 * The atmosphere-derived quantities the characteristic-scale formulas below
 * need. A thin, explicit subset of `EnvSample` (rather than requiring a live
 * `Environment`) so these can be evaluated at scenario-design time, before
 * any solve has run.
 */
export interface CharacteristicEnvironment {
  readonly rho: number; // kg/m^3
  readonly eta: number; // Pa*s
  /** Speed of sound, m/s. Omit or <=0 to treat Mach as 0 (incompressible). */
  readonly c?: number;
  readonly g?: number; // m/s^2, defaults to G_STD
}

/** Reynolds number Re = ρ·v·(2R)/η (§3.3, eq. 3.9). */
export function reynoldsNumber(rho: number, speed: number, radius: number, eta: number): number {
  return (rho * speed * 2 * radius) / eta;
}

/** Mach number M = v/c; 0 for c<=0 or undefined (incompressible / no atmosphere sound speed). */
export function machNumber(speed: number, c: number | undefined): number {
  return c !== undefined && c > 0 ? speed / c : 0;
}

/** Below this relative speed, {@link spinParameter} returns 0 rather than dividing by a near-zero denominator. */
const SPIN_PARAMETER_SPEED_EPS = 1e-9;

/**
 * Magnus spin (ratio) parameter S = |omega|*R/|v_rel| (eq. 3.16), clamped to
 * 0 as `speedRel` -> 0 (§3.6) rather than left to divide by zero -- the
 * Magnus force itself already vanishes there via its own |v_rel| factor, so
 * the clamp only prevents a spurious 0/0 = NaN when spin and speed are both
 * exactly zero. `omega` omitted or 0 (no spin wired) also gives 0.
 */
export function spinParameter(omega: number | undefined, radius: number, speedRel: number): number {
  if (!omega || speedRel < SPIN_PARAMETER_SPEED_EPS) return 0;
  return (Math.abs(omega) * radius) / speedRel;
}

function dragCoefficientAt(
  params: ProjectileParams,
  env: CharacteristicEnvironment,
  speed: number,
): number {
  return params.dragCoefficient.cd(
    reynoldsNumber(env.rho, speed, params.radius, env.eta),
    machNumber(speed, env.c),
  );
}

const TERMINAL_VELOCITY_ITERATIONS = 60;
/** Averaging the previous estimate into each update keeps the fixed point from
 *  oscillating across a non-monotonic Cd(Re) curve (e.g. the drag crisis). */
const TERMINAL_VELOCITY_DAMPING = 0.5;

/**
 * Quadratic-drag terminal velocity v_T = sqrt(2mg / (ρ·Cd(Re(v_T))·A)) (eq. 3.10).
 * Cd generally depends on Re(v_T) itself (tabulated drag-crisis curves), so this
 * fixed-points to self-consistency rather than sampling Cd at an arbitrary speed.
 */
export function terminalVelocityQuadratic(
  params: ProjectileParams,
  env: CharacteristicEnvironment,
): number {
  const g = env.g ?? G_STD;
  let v = Math.sqrt((2 * params.mass * g) / (env.rho * 0.5 * params.area));
  for (let i = 0; i < TERMINAL_VELOCITY_ITERATIONS; i++) {
    const cd = dragCoefficientAt(params, env, v);
    const target = Math.sqrt((2 * params.mass * g) / (env.rho * cd * params.area));
    v = TERMINAL_VELOCITY_DAMPING * v + (1 - TERMINAL_VELOCITY_DAMPING) * target;
  }
  return v;
}

/** Stokes (linear-drag) relaxation time τ = m / (6π·η·R), valid for Re << 1 (§3.5). */
export function dragRelaxationTimeLinear(
  params: ProjectileParams,
  env: CharacteristicEnvironment,
): number {
  return params.mass / (6 * Math.PI * env.eta * params.radius);
}

/**
 * Dimensionless drag-to-gravity group Π = ρ·Cd(Re(v0),M(v0))·A·v0²/(2mg) = (v0/v_T)²
 * (§3.6), evaluated at reference speed v0. By construction, `dimensionlessPi(params,
 * env, terminalVelocityQuadratic(params, env))` is 1 (v0/v_T = 1 at the terminal speed
 * itself).
 */
export function dimensionlessPi(
  params: ProjectileParams,
  env: CharacteristicEnvironment,
  v0: number,
): number {
  const g = env.g ?? G_STD;
  const cd = dragCoefficientAt(params, env, v0);
  return (env.rho * cd * params.area * v0 * v0) / (2 * params.mass * g);
}

/** Drag-free apex-height estimate y_apex ≈ v_y0²/(2g); a quick characteristic scale, not an exact solution once drag is present. */
export function apexHeightEstimate(vy0: number, g: number = G_STD): number {
  return (vy0 * vy0) / (2 * g);
}
