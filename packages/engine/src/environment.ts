import { EnvSample } from "./env-sample.js";
import { EARTH_RADIUS_M, G_STD, ISA } from "./units.js";

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
 * Isothermal exponential atmosphere (§3.4): rho(y) = rho0 * e^(-y/H), scale
 * height H = Rs*T/g ~ 8.5 km. Pressure follows the same exponential (ideal
 * gas at constant T: p = rho*Rs*T), so p(y)/p0 = rho(y)/rho0 identically.
 * Temperature and viscosity are held at their sea-level values — this model
 * captures density falloff only; the linear-lapse ISA troposphere (eq. 3.11)
 * is the Phase-4 upgrade that varies T with altitude too.
 */
export class IsothermalExponentialAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  constructor(
    private readonly rho0: number = ISA.rho0,
    private readonly scaleHeight: number = ISA.scaleHeight,
    private readonly T0: number = ISA.T0,
    private readonly eta: number = 1.789e-5,
  ) {}

  sample(_x: number, y: number, out: EnvSample): void {
    const falloff = Math.exp(-y / this.scaleHeight);
    out.rho = this.rho0 * falloff;
    out.T = this.T0;
    out.p = this.rho0 * ISA.Rs * this.T0 * falloff;
    out.eta = this.eta;
    out.c = Math.sqrt(IsothermalExponentialAtmosphere.GAMMA * ISA.Rs * this.T0);
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

/** Uniform steady wind: w = (wx, wy) everywhere, slider-controlled (§3.5 case 1). */
export class UniformWind implements WindModel {
  constructor(
    private readonly wx: number = 0,
    private readonly wy: number = 0,
  ) {}

  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wx;
    out.wy = this.wy;
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
