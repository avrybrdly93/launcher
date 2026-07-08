import { EnvSample } from "./env-sample.js";
import { EARTH_RADIUS_M, G_STD, ISA, SUTHERLAND } from "./units.js";

/** Fills the thermodynamic fields of an EnvSample (rho, T, p, eta, c) at a point (§3.4). */
export interface Atmosphere {
  sample(x: number, y: number, out: EnvSample): void;
}

/** Fills the gravity field of an EnvSample at a point (§3.2). */
export interface GravityModel {
  sample(x: number, y: number, out: EnvSample): void;
}

/** Fills the wind fields (wx, wy) of an EnvSample at a point and time (§3.5). */
export interface WindModel {
  sample(t: number, x: number, y: number, out: EnvSample): void;
}

/** ISA sea-level atmosphere, uniform with altitude (§3.4 default). */
export class ConstantAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  sample(_x: number, _y: number, out: EnvSample): void {
    out.rho = ISA.rho0;
    out.T = ISA.T0;
    out.p = ISA.p0;
    out.eta = 1.789e-5;
    out.c = Math.sqrt(ConstantAtmosphere.GAMMA * ISA.Rs * ISA.T0);
  }
}

/**
 * Sutherland's law (eq. 3.12): dynamic viscosity as a function of absolute
 * temperature, calibrated against ISA sea level (T=288.15K -> eta=1.789e-5 Pa*s).
 */
export function sutherlandViscosity(temperatureK: number): number {
  const { etaRef, Tref, S } = SUTHERLAND;
  return etaRef * (temperatureK / Tref) ** 1.5 * ((Tref + S) / (temperatureK + S));
}

/**
 * Isothermal exponential atmosphere (§3.4): rho(y) = rho0*e^(-y/H). Since the
 * model is isothermal, T (and therefore eta, c) stay at their ISA sea-level
 * values everywhere; only rho and p (which share rho's exponential via the
 * ideal-gas law at constant T) vary with altitude.
 */
export class ExponentialAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  constructor(
    private readonly rho0 = ISA.rho0,
    private readonly p0 = ISA.p0,
    private readonly scaleHeight = ISA.scaleHeight,
    private readonly T0 = ISA.T0,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    const factor = Math.exp(-y / this.scaleHeight);
    out.rho = this.rho0 * factor;
    out.p = this.p0 * factor;
    out.T = this.T0;
    out.eta = sutherlandViscosity(this.T0);
    out.c = Math.sqrt(ExponentialAtmosphere.GAMMA * ISA.Rs * this.T0);
  }
}

/** Uniform gravity, optionally with the altitude correction (3.3) behind a flag. */
export class UniformGravity implements GravityModel {
  constructor(
    private readonly g0: number = G_STD,
    private readonly altitudeDependent = false,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    if (!this.altitudeDependent) {
      out.g = this.g0;
      return;
    }
    const ratio = EARTH_RADIUS_M / (EARTH_RADIUS_M + y);
    out.g = this.g0 * ratio * ratio;
  }
}

/** Default no-wind model: wx = wy = 0 everywhere (§3.5 case 1 with w = 0). */
export class ZeroWind implements WindModel {
  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = 0;
    out.wy = 0;
  }
}

/** Uniform steady wind (§3.5 case 1): w = (wx, wy), constant in space and time. */
export class UniformWind implements WindModel {
  constructor(
    private readonly wx = 0,
    private readonly wy = 0,
  ) {}

  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

const VON_KARMAN = 0.41;

/**
 * Logarithmic boundary-layer wind profile (eq. 3.13): horizontal wind sheared
 * by height, w_x(y) = (u_star / kappa) . ln((y+y_r)/y_r). y is clamped to
 * >= 0 before the log so a projectile momentarily at/just-below ground
 * (numerical overshoot at the terrain event) never produces a
 * NaN/-Infinity from ln(non-positive) — at y=0 the clamp makes the
 * argument exactly 1, so w_x(0) = 0 rather than singular.
 */
export class LogProfileWind implements WindModel {
  constructor(
    private readonly frictionVelocity: number,
    private readonly roughnessLength = 0.01,
  ) {}

  sample(_t: number, _x: number, y: number, out: EnvSample): void {
    const clampedY = Math.max(y, 0);
    out.wx =
      (this.frictionVelocity / VON_KARMAN) *
      Math.log((clampedY + this.roughnessLength) / this.roughnessLength);
    out.wy = 0;
  }
}

/**
 * Sinusoidal gust wind (§3.5 case 3): w_x(t) = wbar + A*sin(Omega*t + phi),
 * smooth by construction (infinitely differentiable in t) so solver
 * convergence studies stay clean even with gusting enabled. w_y = 0.
 */
export class SinusoidalGustWind implements WindModel {
  constructor(
    private readonly meanWind: number,
    private readonly amplitude: number,
    private readonly angularFrequency: number,
    private readonly phase = 0,
  ) {}

  sample(t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.meanWind + this.amplitude * Math.sin(this.angularFrequency * t + this.phase);
    out.wy = 0;
  }
}

const VORTEX_CORE_EPS = 1e-12;

/**
 * Gaussian-core (Lamb-Oseen) vortex wind field (§3.5 case 3): a smooth,
 * infinitely-differentiable analytic gust structure with tangential speed
 *
 *   v_theta(r) = (Gamma / (2*pi*r)) * (1 - exp(-r^2/r_c^2))
 *
 * around the center (x0, y0), circulation Gamma, and core radius r_c. The
 * (1 - exp(...)) factor removes the 1/r singularity at the center (v_theta
 * -> 0 linearly as r -> 0) and the circulation on any ring of radius r
 * approaches Gamma once r >> r_c (exactly Gamma*(1-exp(-r^2/r_c^2))).
 */
export class GaussianVortexWind implements WindModel {
  constructor(
    private readonly x0: number,
    private readonly y0: number,
    private readonly circulation: number,
    private readonly coreRadius: number,
  ) {}

  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const dx = x - this.x0;
    const dy = y - this.y0;
    const r = Math.hypot(dx, dy);
    if (r < VORTEX_CORE_EPS) {
      out.wx = 0;
      out.wy = 0;
      return;
    }
    const vTheta =
      (this.circulation / (2 * Math.PI * r)) *
      (1 - Math.exp(-(r * r) / (this.coreRadius * this.coreRadius)));
    out.wx = (-vTheta * dy) / r;
    out.wy = (vTheta * dx) / r;
  }
}

/**
 * Composes an Atmosphere + GravityModel + WindModel into the single
 * `Environment` the engine exports (§2.2 module table). `sample` is called
 * exactly once per rhs evaluation (§2.4a); internally it delegates to the
 * three components against the same shared EnvSample buffer.
 */
export class Environment {
  constructor(
    private readonly atmosphere: Atmosphere,
    private readonly gravity: GravityModel,
    private readonly wind: WindModel = new ZeroWind(),
  ) {}

  sample(t: number, x: number, y: number, out: EnvSample): void {
    this.atmosphere.sample(x, y, out);
    this.gravity.sample(x, y, out);
    this.wind.sample(t, x, y, out);
  }
}
