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
 * Logarithmic boundary-layer wind profile (eq. 3.13): wind speed increases
 * with height above a rough surface. `y` is clamped to >= 0 before entering
 * the log so a projectile transiently at or slightly below ground level
 * (numerical overshoot before event detection stops it) still gets a
 * finite, well-defined sample instead of ln() of a non-positive argument.
 */
export class LogProfileWind implements WindField {
  private static readonly KAPPA = 0.41; // von Karman constant

  constructor(
    private readonly uStar: number,
    private readonly roughnessLength = 0.01, // m, grass (§3.5)
  ) {}

  sample(_t: number, _x: number, y: number, out: EnvSample): void {
    const yGround = Math.max(y, 0);
    out.wx =
      (this.uStar / LogProfileWind.KAPPA) *
      Math.log((yGround + this.roughnessLength) / this.roughnessLength);
    out.wy = 0;
  }
}

/** Sinusoidal gust: w_x(t) = mean + amplitude*sin(omega*t + phase) (§3.5 case 3). */
export class SinusoidalGustWind implements WindField {
  constructor(
    private readonly mean: number,
    private readonly amplitude: number,
    private readonly omega: number,
    private readonly phase = 0,
  ) {}

  sample(t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.mean + this.amplitude * Math.sin(this.omega * t + this.phase);
    out.wy = 0;
  }
}

const VORTEX_CORE_EPS = 1e-8;

/**
 * Lamb-Oseen-style Gaussian vortex (§3.5 case 3): purely tangential flow
 * around (centerX, centerY) with circulation `circulation` (Gamma) and
 * Gaussian core radius `coreRadius` (r_c) regularizing the classical
 * irrotational-vortex singularity at r=0. Tangential speed
 * v_theta(r) = Gamma/(2*pi*r) * (1 - e^(-r^2/r_c^2)) -> 0 as r -> 0 and
 * -> Gamma/(2*pi*r) (ideal vortex) as r >> r_c, so the circulation on a
 * ring of radius r approaches Gamma once r is a few core radii out.
 */
export class GaussianVortexWind implements WindField {
  constructor(
    private readonly circulation: number, // Gamma, m^2/s
    private readonly coreRadius: number, // r_c, m
    private readonly centerX = 0,
    private readonly centerY = 0,
  ) {}

  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    const rc2 = this.coreRadius * this.coreRadius;
    const r2 = dx * dx + dy * dy;
    // k(r) = v_theta(r)/r; the r->0 limit is Gamma/(2*pi*r_c^2), used below
    // that threshold to avoid the 0/0 cancellation in the general formula.
    const k =
      r2 < VORTEX_CORE_EPS * rc2
        ? this.circulation / (2 * Math.PI * rc2)
        : (this.circulation / (2 * Math.PI * r2)) * (1 - Math.exp(-r2 / rc2));
    out.wx = -k * dy;
    out.wy = k * dx;
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
