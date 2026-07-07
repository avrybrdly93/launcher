/**
 * Piecewise Cubic Hermite Interpolating Polynomial (Fritsch–Carlson variant).
 * Unlike a natural cubic spline, PCHIP never overshoots monotone data — a
 * property this platform relies on for Cd(Re) tables that must not dip
 * below zero or oscillate near the drag crisis (§3.3). Out-of-domain queries
 * clamp to the nearest endpoint value.
 */
export class PchipInterpolator {
  private readonly x: readonly number[];
  private readonly y: readonly number[];
  private readonly m: readonly number[];

  constructor(x: readonly number[], y: readonly number[]) {
    if (x.length !== y.length || x.length < 2) {
      throw new Error("PchipInterpolator requires matching x/y arrays of length >= 2");
    }
    for (let i = 1; i < x.length; i++) {
      if (!(x[i]! > x[i - 1]!)) {
        throw new Error("PchipInterpolator requires strictly increasing x values");
      }
    }
    this.x = x;
    this.y = y;
    this.m = PchipInterpolator.slopes(x, y);
  }

  /**
   * One-sided, shape-preserving three-point endpoint derivative estimate
   * (Fritsch–Carlson / de Boor, as used by SciPy's `PchipInterpolator`).
   * A naive secant-slope endpoint (d = m0) is *not* equivalent to this and
   * disagrees with SciPy past the first/last knot — this is what the
   * cross-check fixture in pchip.test.ts pins down.
   */
  private static edgeSlope(h0: number, h1: number, m0: number, m1: number): number {
    const d = ((2 * h0 + h1) * m0 - h0 * m1) / (h0 + h1);
    if (Math.sign(d) !== Math.sign(m0)) return 0;
    if (Math.sign(m0) !== Math.sign(m1) && Math.abs(d) > 3 * Math.abs(m0)) return 3 * m0;
    return d;
  }

  private static slopes(x: readonly number[], y: readonly number[]): number[] {
    const n = x.length;
    const h: number[] = [];
    const d: number[] = [];
    for (let i = 0; i < n - 1; i++) {
      const hi = x[i + 1]! - x[i]!;
      h.push(hi);
      d.push((y[i + 1]! - y[i]!) / hi);
    }
    const m = new Array<number>(n).fill(0);
    for (let i = 1; i < n - 1; i++) {
      const dPrev = d[i - 1]!;
      const dNext = d[i]!;
      if (dPrev === 0 || dNext === 0 || dPrev > 0 !== dNext > 0) {
        m[i] = 0;
        continue;
      }
      const w1 = 2 * h[i]! + h[i - 1]!;
      const w2 = h[i]! + 2 * h[i - 1]!;
      m[i] = (w1 + w2) / (w1 / dPrev + w2 / dNext);
    }
    m[0] = n > 2 ? PchipInterpolator.edgeSlope(h[0]!, h[1]!, d[0]!, d[1]!) : d[0]!;
    m[n - 1] =
      n > 2 ? PchipInterpolator.edgeSlope(h[n - 2]!, h[n - 3]!, d[n - 2]!, d[n - 3]!) : d[n - 2]!;
    return m;
  }

  evaluate(xq: number): number {
    const { x, y, m } = this;
    const n = x.length;
    if (xq <= x[0]!) return y[0]!;
    if (xq >= x[n - 1]!) return y[n - 1]!;

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= xq) lo = mid;
      else hi = mid;
    }

    const h = x[hi]! - x[lo]!;
    const t = (xq - x[lo]!) / h;
    const t2 = t * t;
    const t3 = t2 * t;
    const h00 = 2 * t3 - 3 * t2 + 1;
    const h10 = t3 - 2 * t2 + t;
    const h01 = -2 * t3 + 3 * t2;
    const h11 = t3 - t2;
    return h00 * y[lo]! + h10 * h * m[lo]! + h01 * y[hi]! + h11 * h * m[hi]!;
  }

  /**
   * Closed-form dp/dx of the same cubic Hermite piece `evaluate` uses.
   * Matches `evaluate`'s flat clamp outside the domain: derivative is 0
   * there, not the boundary slope `m[0]`/`m[n-1]`.
   */
  derivative(xq: number): number {
    const { x, y, m } = this;
    const n = x.length;
    if (xq <= x[0]! || xq >= x[n - 1]!) return 0;

    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid]! <= xq) lo = mid;
      else hi = mid;
    }

    const h = x[hi]! - x[lo]!;
    const t = (xq - x[lo]!) / h;
    const t2 = t * t;
    const dh00 = 6 * t2 - 6 * t;
    const dh10 = 3 * t2 - 4 * t + 1;
    const dh01 = -6 * t2 + 6 * t;
    const dh11 = 3 * t2 - 2 * t;
    return (dh00 * y[lo]! + dh01 * y[hi]!) / h + dh10 * m[lo]! + dh11 * m[hi]!;
  }
}
