import { EnvSample } from "./env-sample.js";
import { EARTH_RADIUS_M, G_STD, ISA } from "./units.js";
import { sutherlandViscosity } from "./viscosity.js";

/** Fills the thermodynamic fields of an EnvSample (rho, T, p, eta, c) at a point (§3.4). */
export interface Atmosphere {
  sample(x: number, y: number, out: EnvSample): void;
}

/** Fills the gravity field of an EnvSample at a point (§3.2). */
export interface GravityModel {
  sample(x: number, y: number, out: EnvSample): void;
}

/** w(t, r) -> R^d (§3.5): fills the wind fields (wx, wy) of an EnvSample at a point and time. */
export interface WindField {
  sample(t: number, x: number, y: number, out: EnvSample): void;
}

/** ISA sea-level atmosphere, uniform with altitude (§3.4 default). */
export class ConstantAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  sample(_x: number, _y: number, out: EnvSample): void {
    out.rho = ISA.rho0;
    out.T = ISA.T0;
    out.p = ISA.p0;
    out.eta = sutherlandViscosity(out.T);
    out.c = Math.sqrt(ConstantAtmosphere.GAMMA * ISA.Rs * ISA.T0);
  }
}

/**
 * Isothermal exponential atmosphere rho(y) = rho0*e^(-y/H) (§3.4). Pressure
 * follows the same decay (p = rho*Rs*T with T held constant); temperature,
 * viscosity, and speed of sound stay at their ISA sea-level values since the
 * isothermal approximation holds T fixed.
 */
export class ExponentialAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  constructor(
    private readonly rho0: number = ISA.rho0,
    private readonly scaleHeight: number = ISA.scaleHeight,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    const ratio = Math.exp(-y / this.scaleHeight);
    out.rho = this.rho0 * ratio;
    out.T = ISA.T0;
    out.p = ISA.p0 * ratio;
    out.eta = sutherlandViscosity(out.T);
    out.c = Math.sqrt(ExponentialAtmosphere.GAMMA * ISA.Rs * ISA.T0);
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

/** Default no-wind field: wx = wy = 0 everywhere (§3.5 case 1 with w = 0). */
export class ZeroWind implements WindField {
  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = 0;
    out.wy = 0;
  }
}

/** Uniform steady wind (§3.5 case 1): w = (wx, wy), constant over all t and r. */
export class UniformWind implements WindField {
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
 * Composes an Atmosphere + GravityModel + WindField into the single
 * `Environment` the engine exports (§2.2 module table). `sample` is called
 * exactly once per rhs evaluation (§2.4a); internally it delegates to the
 * three components against the same shared EnvSample buffer.
 */
export class Environment {
  constructor(
    private readonly atmosphere: Atmosphere,
    private readonly gravity: GravityModel,
    private readonly wind: WindField = new ZeroWind(),
  ) {}

  sample(t: number, x: number, y: number, out: EnvSample): void {
    this.atmosphere.sample(x, y, out);
    this.gravity.sample(x, y, out);
    this.wind.sample(t, x, y, out);
  }
}
