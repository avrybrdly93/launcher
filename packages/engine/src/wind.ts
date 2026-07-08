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
