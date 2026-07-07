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

const ADIABATIC_INDEX_AIR = 1.4;

/** Sutherland's law, eta(T) = etaRef*(T/Tref)^1.5*(Tref+S)/(T+S) (eq. 3.12). */
export function sutherlandViscosity(T: number): number {
  return (
    SUTHERLAND.etaRef *
    (T / SUTHERLAND.Tref) ** 1.5 *
    ((SUTHERLAND.Tref + SUTHERLAND.S) / (T + SUTHERLAND.S))
  );
}

/** ISA sea-level atmosphere, uniform with altitude (§3.4 default). */
export class ConstantAtmosphere implements Atmosphere {
  sample(_x: number, _y: number, out: EnvSample): void {
    out.rho = ISA.rho0;
    out.T = ISA.T0;
    out.p = ISA.p0;
    out.eta = 1.789e-5;
    out.c = Math.sqrt(ADIABATIC_INDEX_AIR * ISA.Rs * ISA.T0);
  }
}

/**
 * Isothermal exponential atmosphere, rho(y) = rho0*e^(-y/H) (§3.4). Held
 * isothermal at `T0` by construction, so p follows from the ideal gas law
 * at that fixed T, and eta/c (which depend only on T here) are the same
 * constants `ConstantAtmosphere` returns.
 */
export class ExponentialAtmosphere implements Atmosphere {
  constructor(
    private readonly rho0: number = ISA.rho0,
    private readonly scaleHeight: number = ISA.scaleHeight,
    private readonly T0: number = ISA.T0,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    out.T = this.T0;
    out.rho = this.rho0 * Math.exp(-y / this.scaleHeight);
    out.p = out.rho * ISA.Rs * this.T0;
    out.eta = sutherlandViscosity(this.T0);
    out.c = Math.sqrt(ADIABATIC_INDEX_AIR * ISA.Rs * this.T0);
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

/** Uniform steady wind, constant everywhere in space and time (§3.5 case 1). */
export class UniformWind implements WindModel {
  constructor(
    private readonly wx: number,
    private readonly wy: number = 0,
  ) {}

  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

/**
 * Logarithmic boundary-layer wind profile (eq. 3.13):
 * w_x(y) = (u_star / kappa) * ln((y + y_r) / y_r), friction velocity u_star,
 * von Karman constant kappa = 0.41, roughness length y_r (grass ~ 0.01 m).
 * Height is clamped to >= 0 before evaluating the log, so this stays finite
 * (returns the y=0 value, 0) for any y <= 0 instead of taking the log of a
 * non-positive number.
 */
export class LogProfileWind implements WindModel {
  static readonly VON_KARMAN = 0.41;

  constructor(
    private readonly frictionVelocity: number,
    private readonly roughnessLength = 0.01,
    private readonly kappa: number = LogProfileWind.VON_KARMAN,
  ) {}

  sample(_t: number, _x: number, y: number, out: EnvSample): void {
    const yClamped = Math.max(y, 0);
    out.wx =
      (this.frictionVelocity / this.kappa) *
      Math.log((yClamped + this.roughnessLength) / this.roughnessLength);
    out.wy = 0;
  }
}

/** Sinusoidal gust: w_x(t) = wMean + amplitude*sin(angularFrequency*t + phase) (§3.5 case 3). */
export class SinusoidalGustWind implements WindModel {
  constructor(
    private readonly wMean: number,
    private readonly amplitude: number,
    private readonly angularFrequency: number,
    private readonly phase = 0,
  ) {}

  sample(t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wMean + this.amplitude * Math.sin(this.angularFrequency * t + this.phase);
    out.wy = 0;
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
