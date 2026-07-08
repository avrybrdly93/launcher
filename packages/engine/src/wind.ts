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
