import { EnvSample } from "./env-sample.js";
import { EARTH_RADIUS_M, G_STD, ISA, sutherlandViscosity } from "./units.js";

/** Fills the thermodynamic fields of an EnvSample (rho, T, p, eta, c) at a point (§3.4). */
export interface Atmosphere {
  /** Writes rho, T, p, eta, c into `out` at world position (x, y). */
  sample(x: number, y: number, out: EnvSample): void;
}

/** Fills the gravity field of an EnvSample at a point (§3.2). */
export interface GravityModel {
  /** Writes `g` into `out` at world position (x, y). */
  sample(x: number, y: number, out: EnvSample): void;
}

/** Fills the wind fields (wx, wy) of an EnvSample at a point and time (§3.5). */
export interface WindModel {
  /** Writes wx, wy into `out` at time `t` and world position (x, y). */
  sample(t: number, x: number, y: number, out: EnvSample): void;
}

/** ISA sea-level atmosphere, uniform with altitude (§3.4 default). */
export class ConstantAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  /** @inheritDoc */
  sample(_x: number, _y: number, out: EnvSample): void {
    out.rho = ISA.rho0;
    out.T = ISA.T0;
    out.p = ISA.p0;
    out.eta = sutherlandViscosity(ISA.T0);
    out.c = Math.sqrt(ConstantAtmosphere.GAMMA * ISA.Rs * ISA.T0);
  }
}

/**
 * Isothermal exponential atmosphere (§3.4): rho(y) = rho0*e^(-y/H), scale
 * height H = Rs*T/g ~= 8.5 km. Temperature is held fixed (isothermal), and
 * pressure follows the same exponential decay so that p = rho*Rs*T remains
 * consistent with the ideal-gas law at every altitude.
 */
export class ExponentialAtmosphere implements Atmosphere {
  private static readonly GAMMA = 1.4;

  constructor(
    private readonly rho0: number = ISA.rho0,
    private readonly T0: number = ISA.T0,
    private readonly p0: number = ISA.p0,
    private readonly scaleHeight: number = ISA.scaleHeight,
  ) {}

  /** @inheritDoc */
  sample(_x: number, y: number, out: EnvSample): void {
    const factor = Math.exp(-y / this.scaleHeight);
    out.rho = this.rho0 * factor;
    out.T = this.T0;
    out.p = this.p0 * factor;
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

  /** @inheritDoc */
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
  /** @inheritDoc */
  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = 0;
    out.wy = 0;
  }
}

/** Uniform steady wind (§3.5 case 1): w = (wx, wy), constant in time and space. */
export class UniformWind implements WindModel {
  constructor(
    private readonly wx: number,
    private readonly wy: number = 0,
  ) {}

  /** @inheritDoc */
  sample(_t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.wx;
    out.wy = this.wy;
  }
}

/**
 * Logarithmic boundary-layer wind profile (§3.5 eq. 3.13): horizontal wind
 * sheared by height, wx(y) = (uStar / kappa) * ln((y + yr) / yr), with von
 * Karman constant kappa = 0.41 and roughness length yr (grass ~= 0.01 m).
 * Height is clamped to y >= 0 before evaluation: the formula is
 * singular/undefined for y <= -yr and physically the profile terminates at
 * the ground, so below ground it returns the y=0 value (0) rather than NaN.
 */
export class LogProfileWind implements WindModel {
  private static readonly KAPPA = 0.41;

  constructor(
    private readonly frictionVelocity: number, // u*, m/s
    private readonly roughnessLength: number = 0.01, // yr, m
    private readonly wy: number = 0,
  ) {}

  /** @inheritDoc */
  sample(_t: number, _x: number, y: number, out: EnvSample): void {
    const yEff = Math.max(y, 0);
    out.wx =
      (this.frictionVelocity / LogProfileWind.KAPPA) *
      Math.log((yEff + this.roughnessLength) / this.roughnessLength);
    out.wy = this.wy;
  }
}

/**
 * Sinusoidal gust wind (§3.5 case 3): wx(t) = wbar + A*sin(Omega*t + phi), a
 * smooth-by-construction time-varying wind so that solver convergence
 * studies stay clean (no kinks for the stepper to trip over).
 */
export class SinusoidalGustWind implements WindModel {
  constructor(
    private readonly mean: number, // wbar, m/s
    private readonly amplitude: number, // A, m/s
    private readonly angularFrequency: number, // Omega, rad/s
    private readonly phase: number = 0, // phi, rad
    private readonly wy: number = 0,
  ) {}

  /** @inheritDoc */
  sample(t: number, _x: number, _y: number, out: EnvSample): void {
    out.wx = this.mean + this.amplitude * Math.sin(this.angularFrequency * t + this.phase);
    out.wy = this.wy;
  }
}

/**
 * Gaussian (Lamb-Oseen) vortex analytic wind field (§3.5 case 3): tangential
 * speed vTheta(r) = (Gamma / (2*pi*r)) * (1 - exp(-r^2/rc^2)), circulation
 * Gamma, core radius rc. vTheta -> 0 smoothly as r -> 0 (no solid-body
 * singularity), so r = 0 is handled explicitly rather than dividing by zero.
 */
export class GaussianVortexWind implements WindModel {
  constructor(
    private readonly circulation: number, // Gamma, m^2/s
    private readonly coreRadius: number, // rc, m
    private readonly centerX: number = 0,
    private readonly centerY: number = 0,
  ) {}

  /** @inheritDoc */
  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    const r = Math.hypot(dx, dy);
    if (r === 0) {
      out.wx = 0;
      out.wy = 0;
      return;
    }
    const vTheta =
      (this.circulation / (2 * Math.PI * r)) *
      (1 - Math.exp(-(r * r) / (this.coreRadius * this.coreRadius)));
    out.wx = -vTheta * (dy / r);
    out.wy = vTheta * (dx / r);
  }
}

/** A rectilinear grid of wind samples (§3.5 case 5): origin (x0,y0), uniform spacing (dx,dy), nx*ny nodes, row-major. */
export interface GriddedWindFieldData {
  readonly x0: number;
  readonly y0: number;
  readonly dx: number;
  readonly dy: number;
  readonly nx: number;
  readonly ny: number;
  readonly wx: readonly number[]; // length nx*ny, row-major: index = j*nx + i
  readonly wy: readonly number[]; // length nx*ny, row-major: index = j*nx + i
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

/**
 * Gridded wind field with bilinear interpolation (§3.5 case 5) -- the seam
 * for future imported/CFD-derived fields. Out-of-domain policy: query
 * points are clamped to the grid's bounding box before interpolating, i.e.
 * the field is held constant at its edge value beyond the domain (rather
 * than extrapolating or erroring).
 */
export class GriddedWindField implements WindModel {
  constructor(private readonly grid: GriddedWindFieldData) {}

  /** @inheritDoc */
  sample(_t: number, x: number, y: number, out: EnvSample): void {
    out.wx = this.bilinear(x, y, this.grid.wx);
    out.wy = this.bilinear(x, y, this.grid.wy);
  }

  private bilinear(x: number, y: number, values: readonly number[]): number {
    const { x0, y0, dx, dy, nx, ny } = this.grid;
    const fx = clamp((x - x0) / dx, 0, nx - 1);
    const fy = clamp((y - y0) / dy, 0, ny - 1);
    const i0 = Math.min(Math.floor(fx), Math.max(nx - 2, 0));
    const j0 = Math.min(Math.floor(fy), Math.max(ny - 2, 0));
    const i1 = Math.min(i0 + 1, nx - 1);
    const j1 = Math.min(j0 + 1, ny - 1);
    const tx = nx > 1 ? fx - i0 : 0;
    const ty = ny > 1 ? fy - j0 : 0;
    const v00 = values[j0 * nx + i0]!;
    const v10 = values[j0 * nx + i1]!;
    const v01 = values[j1 * nx + i0]!;
    const v11 = values[j1 * nx + i1]!;
    const v0 = v00 * (1 - tx) + v10 * tx;
    const v1 = v01 * (1 - tx) + v11 * tx;
    return v0 * (1 - ty) + v1 * ty;
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

  /** Samples atmosphere, gravity, and wind into `out` at time `t`, position (x, y). */
  sample(t: number, x: number, y: number, out: EnvSample): void {
    this.atmosphere.sample(x, y, out);
    this.gravity.sample(x, y, out);
    this.wind.sample(t, x, y, out);
  }
}
