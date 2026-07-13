import { EnvSample } from "./env-sample.js";
import { EARTH_RADIUS_M, G_STD, ISA, SUTHERLAND } from "./units.js";

/** Fills the thermodynamic fields of an EnvSample (rho, T, p, eta, c) at a point (§3.4). */
export interface Atmosphere {
  sample(x: number, y: number, out: EnvSample): void;
}

/**
 * Sutherland's law: dynamic viscosity η as a function of temperature
 * (§3.4, eq. 3.12). At T = SUTHERLAND.Tref this reduces exactly to
 * SUTHERLAND.etaRef (both ratios become 1), which is what backs
 * Constant/ExponentialAtmosphere's isothermal η below instead of
 * duplicating that reference value as a separate literal.
 */
export function sutherlandViscosity(T: number): number {
  return (
    SUTHERLAND.etaRef *
    (T / SUTHERLAND.Tref) ** 1.5 *
    ((SUTHERLAND.Tref + SUTHERLAND.S) / (T + SUTHERLAND.S))
  );
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
    out.eta = sutherlandViscosity(ISA.T0);
    out.c = Math.sqrt(ConstantAtmosphere.GAMMA * ISA.Rs * ISA.T0);
  }
}

/**
 * Isothermal exponential atmosphere ρ(y) = ρ₀e^(−y/H) (§3.4, eq. between
 * 3.10-3.11, P1.27). Temperature, viscosity and speed of sound stay at
 * their ISA sea-level values since the model is isothermal by construction
 * — only density (and, via the ideal gas law, pressure) vary with height.
 */
export class ExponentialAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  constructor(
    private readonly rho0 = ISA.rho0,
    private readonly scaleHeight = ISA.scaleHeight,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    out.rho = this.rho0 * Math.exp(-y / this.scaleHeight);
    out.T = ISA.T0;
    out.eta = sutherlandViscosity(ISA.T0);
    out.c = Math.sqrt(ExponentialAtmosphere.GAMMA * ISA.Rs * ISA.T0);
    out.p = out.rho * ISA.Rs * ISA.T0;
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
