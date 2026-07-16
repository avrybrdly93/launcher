import type { Model } from "./model.js";

/** Frozen physical parameters the gravity+quadratic-drag Jacobian linearizes about. */
export interface GravityQuadraticDragJacobianParams {
  readonly mass: number; // kg
  readonly area: number; // m^2
  /** Drag coefficient, treated as locally frozen (not re-differentiated through Cd(Re)); see module doc. */
  readonly cd: number;
  readonly rho: number; // kg/m^3
  readonly wx?: number; // m/s, steady wind (position/time-independent in this reduced model)
  readonly wy?: number; // m/s
}

const ZERO_SPEED_EPS = 1e-12;

/**
 * Analytic J = ∂f/∂y for the planar `[x, y, vx, vy]` state under gravity +
 * quadratic drag only (no Magnus, eq. 3.18 with F_M = 0), matching the
 * `Model.jacobian?(t, y, out)` contract of §3.7 — which, notably, is not
 * passed an `EvalContext`, so this factory bakes in ρ, Cd, area, mass, and
 * wind as constants of the linearization rather than resampling them.
 *
 * This is exact wherever those quantities really are constant (the default
 * `ConstantAtmosphere` + `ConstantCd` + `ZeroWind`/uniform-wind combination).
 * It is *not* exact when Cd varies with Re (`TabulatedReynoldsCd`) or gravity
 * varies with altitude, since those state-dependencies aren't differentiated
 * through — matching the frozen-coefficient eigenvalue estimate of §4.3.
 * Those richer cases are exactly what the finite-difference fallback (P1.23)
 * covers instead. Gravity itself contributes no entries: g only appears as
 * an additive constant in f3, so ∂f3/∂y is unaffected by g's value.
 *
 * `out` must be a length-16 buffer, written row-major: `out[4*i + j] = ∂f_i/∂y_j`.
 */
export function createGravityQuadraticDragJacobian(
  params: GravityQuadraticDragJacobianParams,
): NonNullable<Model["jacobian"]> {
  const k = (0.5 * params.rho * params.cd * params.area) / params.mass;
  const wx = params.wx ?? 0;
  const wy = params.wy ?? 0;

  return (_t: number, y: Float64Array, out: Float64Array): void => {
    out.fill(0);
    out[0 * 4 + 2] = 1; // dx/dt = vx
    out[1 * 4 + 3] = 1; // dy/dt = vy

    const u1 = y[2]! - wx;
    const u2 = y[3]! - wy;
    const speed = Math.hypot(u1, u2);

    // d/du (|u| u) = |u| I + u u^T / |u|, which -> the zero matrix as u -> 0
    // (the map is C^1 with a zero derivative at the origin, P1.09/§3.8), so
    // leaving these entries at 0 from the fill above is the correct limit.
    if (speed < ZERO_SPEED_EPS) {
      return;
    }

    const invSpeed = 1 / speed;
    const dvxDvx = -k * (speed + u1 * u1 * invSpeed);
    const dvxDvy = -k * (u1 * u2 * invSpeed);
    const dvyDvx = dvxDvy;
    const dvyDvy = -k * (speed + u2 * u2 * invSpeed);

    out[2 * 4 + 2] = dvxDvx;
    out[2 * 4 + 3] = dvxDvy;
    out[3 * 4 + 2] = dvyDvx;
    out[3 * 4 + 3] = dvyDvy;
  };
}
