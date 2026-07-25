/**
 * Linear stability analysis (§4.6, P3.43): the scalar stability function
 * $R(z)$ a one-step method applies to the Dahlquist test equation $\dot y =
 * \lambda y$ ($z = h\lambda$), its $|R(z)|=1$ boundary sampled on a grid for
 * contour rendering, and the 2x2 real-matrix eigenvalue closed form used to
 * turn a scenario's velocity-block Jacobian into the $h\lambda$ points the
 * Solver Lab overlays on top of that contour (eq. 4.11/4.12).
 */

/** A complex number as a plain `{re, im}` pair -- this module never needs more than +, *, and magnitude, so a full complex-arithmetic module would be overkill. */
export interface Complex {
  readonly re: number;
  readonly im: number;
}

/**
 * $R(z) = \sum_{j=0}^{n} z^j/j!$ (eq. 4.11), evaluated by Horner's method on
 * the equivalent nested form $R(z) = 1 + z(1 + \tfrac z2(1 + \tfrac z3( \dots
 * (1 + \tfrac zn) \dots)))$ rather than summing terms directly, so no
 * intermediate $z^j$ or $j!$ ever risks overflowing for the orders this
 * platform uses (n <= 4). This closed form is exact for a method whose stage
 * count equals its order (explicit Euler n=1, the RK2 pair n=2, classical
 * RK4 n=4, per the blueprint's explicit statement of eq. 4.11) -- it is
 * *not* the true stability polynomial of a higher-stage-than-order method
 * like Bogacki-Shampine 3(2) or Dormand-Prince 5(4), which this module does
 * not attempt to support.
 */
export function stabilityFunction(order: number, z: Complex): Complex {
  let re = 1;
  let im = 0;
  for (let k = order; k >= 1; k--) {
    const invK = 1 / k;
    const zkRe = z.re * invK;
    const zkIm = z.im * invK;
    const mulRe = zkRe * re - zkIm * im;
    const mulIm = zkRe * im + zkIm * re;
    re = 1 + mulRe;
    im = mulIm;
  }
  return { re, im };
}

/** $|R(z)|$ -- the quantity whose $=1$ level set is the stability-region boundary $\mathcal S$. */
export function stabilityFunctionMagnitude(order: number, z: Complex): number {
  const r = stabilityFunction(order, z);
  return Math.hypot(r.re, r.im);
}

/** An axis-aligned grid over the complex plane with $|R(z)|$ sampled at every node, ready to hand a contour-plotting layer (§6.2/P3.43). */
export interface StabilityRegionGrid {
  /** Real-axis sample coordinates, length `reAxis.length`. */
  readonly reAxis: readonly number[];
  /** Imaginary-axis sample coordinates, length `imAxis.length`. */
  readonly imAxis: readonly number[];
  /** Row-major `magnitude[row][col]`, `row` indexing `imAxis` and `col` indexing `reAxis` -- the shape Plotly's `contour` trace expects for its `z`. */
  readonly magnitude: readonly (readonly number[])[];
}

/**
 * Samples `|R(z)|` for `order` on a `nRe` x `nIm` grid spanning
 * `reRange`/`imRange`, inclusive of both endpoints. Pure and allocation-light
 * (one array per row plus the axis arrays) -- this runs once per method
 * selection, not per animation frame, so it is not written for the
 * zero-allocation hot-path discipline the rhs path requires (ADR-004 scopes
 * that to per-step solver work, not exploratory-pane figure building).
 */
export function sampleStabilityRegionGrid(
  order: number,
  reRange: readonly [number, number],
  imRange: readonly [number, number],
  nRe: number,
  nIm: number,
): StabilityRegionGrid {
  if (nRe < 2 || nIm < 2) {
    throw new Error(`sampleStabilityRegionGrid: nRe and nIm must each be >= 2, got ${nRe}, ${nIm}`);
  }

  const [reMin, reMax] = reRange;
  const [imMin, imMax] = imRange;
  const reAxis = Array.from({ length: nRe }, (_, j) => reMin + ((reMax - reMin) * j) / (nRe - 1));
  const imAxis = Array.from({ length: nIm }, (_, i) => imMin + ((imMax - imMin) * i) / (nIm - 1));

  const magnitude = imAxis.map((im) =>
    reAxis.map((re) => stabilityFunctionMagnitude(order, { re, im })),
  );

  return { reAxis, imAxis, magnitude };
}

/**
 * Closed-form eigenvalues of a real 2x2 matrix `[[a, b], [c, d]]`
 * (companion to the velocity-block linearization of eq. 4.12: `a = d(vx')/dvx`,
 * `b = d(vx')/dvy`, `c = d(vy')/dvx`, `d = d(vy')/dvy`). Real when the
 * discriminant `trace^2 - 4*det` is non-negative, otherwise a conjugate
 * pair -- both cases are returned as {@link Complex} so the caller doesn't
 * need to branch on which one it got.
 */
export function eigenvalues2x2(
  a: number,
  b: number,
  c: number,
  d: number,
): readonly [Complex, Complex] {
  const trace = a + d;
  const det = a * d - b * c;
  const discriminant = trace * trace - 4 * det;

  if (discriminant >= 0) {
    const sqrtDisc = Math.sqrt(discriminant);
    return [
      { re: (trace + sqrtDisc) / 2, im: 0 },
      { re: (trace - sqrtDisc) / 2, im: 0 },
    ];
  }

  const imagPart = Math.sqrt(-discriminant) / 2;
  return [
    { re: trace / 2, im: imagPart },
    { re: trace / 2, im: -imagPart },
  ];
}
