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

/**
 * A rectilinear grid of wind samples (§3.5 case 5): `wx`/`wy` are row-major
 * over `ys` then `xs` (index = j*xs.length + i, for xs[i], ys[j]). The seam
 * for future imported/CFD-derived fields.
 */
export interface WindGrid {
  readonly xs: readonly number[];
  readonly ys: readonly number[];
  readonly wx: readonly number[];
  readonly wy: readonly number[];
}

/** Largest index i such that arr[i] <= v, clamped to [0, arr.length-2] (binary search). */
function floorIntervalIndex(arr: readonly number[], v: number): number {
  if (v <= arr[0]!) return 0;
  const last = arr.length - 1;
  if (v >= arr[last]!) return last - 1;

  let low = 0;
  let high = last;
  while (high - low > 1) {
    const mid = (low + high) >> 1;
    if (arr[mid]! <= v) low = mid;
    else high = mid;
  }
  return low;
}

function bilerp(
  v00: number,
  v10: number,
  v01: number,
  v11: number,
  tx: number,
  ty: number,
): number {
  const bottom = v00 * (1 - tx) + v10 * tx;
  const top = v01 * (1 - tx) + v11 * tx;
  return bottom * (1 - ty) + top * ty;
}

/**
 * Gridded wind field with bilinear interpolation (§3.5 case 5). Queries
 * outside the grid's domain are clamped to the nearest edge (both the
 * lookup position and, consequently, the returned wind vector are held at
 * their boundary value) rather than extrapolated -- a deliberate, documented
 * policy so off-grid behavior is bounded and predictable.
 */
export class GriddedWindField implements WindModel {
  constructor(private readonly grid: WindGrid) {}

  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const { xs, ys, wx, wy } = this.grid;
    const nx = xs.length;

    const xc = Math.min(Math.max(x, xs[0]!), xs[nx - 1]!);
    const yc = Math.min(Math.max(y, ys[0]!), ys[ys.length - 1]!);

    const i = floorIntervalIndex(xs, xc);
    const j = floorIntervalIndex(ys, yc);
    const x0 = xs[i]!;
    const x1 = xs[i + 1]!;
    const y0 = ys[j]!;
    const y1 = ys[j + 1]!;
    const tx = x1 === x0 ? 0 : (xc - x0) / (x1 - x0);
    const ty = y1 === y0 ? 0 : (yc - y0) / (y1 - y0);

    const idx00 = j * nx + i;
    const idx10 = j * nx + (i + 1);
    const idx01 = (j + 1) * nx + i;
    const idx11 = (j + 1) * nx + (i + 1);

    out.wx = bilerp(wx[idx00]!, wx[idx10]!, wx[idx01]!, wx[idx11]!, tx, ty);
    out.wy = bilerp(wy[idx00]!, wy[idx10]!, wy[idx01]!, wy[idx11]!, tx, ty);
  }
}
