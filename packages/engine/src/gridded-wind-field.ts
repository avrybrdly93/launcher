import type { EnvSample } from "./env-sample.js";
import type { WindModel } from "./environment.js";

/** Row-major-by-y rectilinear grid of wind samples: `wx[iy][ix]`, `wy[iy][ix]`. */
export interface GriddedWindFieldData {
  /** Strictly ascending grid x-coordinates. */
  readonly xs: readonly number[];
  /** Strictly ascending grid y-coordinates. */
  readonly ys: readonly number[];
  readonly wx: readonly (readonly number[])[];
  readonly wy: readonly (readonly number[])[];
}

interface Bracket {
  readonly lo: number;
  readonly hi: number;
  readonly frac: number;
}

/**
 * Finds the grid cell bracketing `value` in the ascending `coords` array.
 * Out-of-domain queries are clamped to the nearest edge (lo == hi == the
 * boundary index, frac = 0) rather than extrapolated — the documented
 * out-of-domain policy (P1.33): a projectile that flies past the edge of a
 * sampled/imported wind field holds the boundary value rather than
 * extrapolating into data that was never measured there.
 */
function locateBracket(coords: readonly number[], value: number): Bracket {
  const n = coords.length;
  const last = n - 1;
  if (value <= coords[0]!) return { lo: 0, hi: 0, frac: 0 };
  if (value >= coords[last]!) return { lo: last, hi: last, frac: 0 };
  for (let i = 0; i < last; i++) {
    if (value <= coords[i + 1]!) {
      const span = coords[i + 1]! - coords[i]!;
      return { lo: i, hi: i + 1, frac: span > 0 ? (value - coords[i]!) / span : 0 };
    }
  }
  return { lo: last, hi: last, frac: 0 };
}

function bilinear(grid: readonly (readonly number[])[], bx: Bracket, by: Bracket): number {
  const v00 = grid[by.lo]![bx.lo]!;
  const v01 = grid[by.lo]![bx.hi]!;
  const v10 = grid[by.hi]![bx.lo]!;
  const v11 = grid[by.hi]![bx.hi]!;
  const vLo = v00 + (v01 - v00) * bx.frac;
  const vHi = v10 + (v11 - v10) * bx.frac;
  return vLo + (vHi - vLo) * by.frac;
}

/**
 * Wind sampled on a rectilinear grid with bilinear interpolation (§3.5 case
 * 5) — the seam for future imported/CFD-derived fields. Bilinear
 * interpolation is exact for any field affine in (x, y), which is what
 * P1.33's validation criterion checks. Out-of-domain queries clamp to the
 * nearest grid edge (see `locateBracket`) rather than extrapolating.
 */
export class GriddedWindField implements WindModel {
  constructor(private readonly data: GriddedWindFieldData) {}

  sample(_t: number, x: number, y: number, out: EnvSample): void {
    const bx = locateBracket(this.data.xs, x);
    const by = locateBracket(this.data.ys, y);
    out.wx = bilinear(this.data.wx, bx, by);
    out.wy = bilinear(this.data.wy, bx, by);
  }
}
