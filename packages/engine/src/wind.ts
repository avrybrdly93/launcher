import type { EnvSample } from "./env-sample.js";
import type { WindModel } from "./environment.js";

/** Uniform steady wind (§3.5 case 1): w = (wx, wy) everywhere, slider-controlled. */
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

const VON_KARMAN = 0.41;

/**
 * Logarithmic boundary-layer wind profile (§3.5 case 2, eq. 3.13):
 * w_x(y) = (u_star / kappa) * ln((y+y_r)/y_r). Height is clamped to >= 0
 * before the log so that y<=0 (ground level and below) never produces a
 * non-finite result -- w_x(0) = 0 exactly, since ln(y_r/y_r) = ln(1) = 0.
 */
export class LogProfileWind implements WindModel {
  constructor(
    private readonly frictionVelocity: number,
    private readonly roughnessLength = 0.01,
    private readonly kappa = VON_KARMAN,
  ) {}

  sample(_t: number, _x: number, y: number, out: EnvSample): void {
    const yEff = Math.max(y, 0);
    out.wx =
      (this.frictionVelocity / this.kappa) *
      Math.log((yEff + this.roughnessLength) / this.roughnessLength);
    out.wy = 0;
  }
}

/**
 * Sinusoidal gust (§3.5 case 3): w_x(t) = mean + amplitude*sin(omega*t +
 * phase). Smooth by construction (C-infinity in t), so solver convergence
 * studies against it remain clean.
 */
export class SinusoidalGustWind implements WindModel {
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

const VORTEX_CORE_EPS = 1e-9;

/**
 * Gaussian (Lamb-Oseen) vortex (§3.5 case 3): tangential speed
 * v_theta(r) = (circulation / (2*pi*r)) * (1 - exp(-(r/coreRadius)^2)),
 * regularized so it vanishes linearly (not singularly) at the vortex
 * center. The enclosed circulation at radius r is
 * circulation*(1-exp(-(r/coreRadius)^2)), approaching the full
 * `circulation` for r >> coreRadius.
 */
export class GaussianVortexWind implements WindModel {
  constructor(
    private readonly centerX: number,
    private readonly centerY: number,
    private readonly circulation: number,
    private readonly coreRadius: number,
  ) {}

  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const dx = x - this.centerX;
    const dy = y - this.centerY;
    const r = Math.hypot(dx, dy);

    if (r < VORTEX_CORE_EPS) {
      out.wx = 0;
      out.wy = 0;
      return;
    }

    // v_theta/r, so multiplying by (-dy, dx) directly gives the tangential
    // velocity without a second division by r.
    const factor =
      (this.circulation / (2 * Math.PI * r * r)) * (1 - Math.exp(-((r / this.coreRadius) ** 2)));
    out.wx = -factor * dy;
    out.wy = factor * dx;
  }
}
