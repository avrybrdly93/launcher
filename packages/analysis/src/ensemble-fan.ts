/**
 * Trajectory ensemble fan: quantile envelope bands over time (P6.10, §6
 * phase-6 table: "Trajectory ensemble fan: quantile envelope bands
 * (5/25/50/75/95%) over time via dense-output resampling on common grid",
 * validation "bands nested and monotone; median ≈ nominal for symmetric
 * inputs").
 *
 * A Monte Carlo ensemble is a set of trajectories that do not share a time
 * grid: every replicate is integrated adaptively, so replicate 3's accepted
 * steps land at different times from replicate 4's, and the two arrays cannot
 * be compared row by row at all. Everything downstream of this module -- a
 * fan chart, a tornado plot, a per-time sensitivity -- needs them on a
 * *common* grid first. That is the whole of what {@link resampleOnGrid} does,
 * and it is the reason the task title says "via dense-output resampling"
 * rather than simply "quantiles".
 *
 * **Nothing here draws.** Every function here returns plain typed arrays;
 * P6.20 and P6.24 render them, the same split `viz/impact-scatter.ts` used for
 * P6.09.
 *
 * ## The interpolation, and why it really is dense output
 *
 * A `Trajectory` (`solverkit/trajectory-recorder.ts`) holds the accepted
 * steps only, so reading a value between two of them means interpolating.
 * Linear interpolation is the obvious choice and it is the wrong one: it is
 * second-order accurate, so resampling a DOPRI5 solve with it throws away
 * three orders of the accuracy the solve was paid for, and it does so
 * invisibly -- the resampled curve still looks like a trajectory.
 *
 * What this module uses instead, whenever the caller can name one, is a
 * **derivative channel**: cubic Hermite interpolation from the two endpoint
 * states *and their two endpoint derivatives*, which is exactly the
 * construction `HermiteDenseOutputStepper` performs inside the solver. For a
 * ballistic state vector the derivatives are already in the row -- `dx/dt` is
 * `vx` and `dy/dt` is `vy`, both recorded channels -- so third-order dense
 * output is available from the recorded trajectory alone, with no change to
 * `Sink` and no second integration. That is a property of *this* model
 * family, not a general fact, which is why {@link ResampleOptions} makes the
 * derivative channel an explicit argument rather than guessing at one: a
 * caller resampling a velocity channel has no recorded acceleration to hand
 * and gets the documented linear fallback instead of a silently wrong cubic.
 *
 * ## What a band is a quantile *of*
 *
 * Replicates end at different times: a shot with more drag lands sooner. So
 * past the earliest impact the ensemble thins, and a quantile at such a time
 * is conditional on the replicate still being in flight. That is a real and
 * easily-missed change of meaning -- the 95th percentile of "everyone still
 * airborne at t = 9 s" is not the 95th percentile of the ensemble -- so
 * {@link EnsembleFan} carries {@link EnsembleFan.sampleCount} per grid point
 * and {@link EnsembleFan.commonSupportEnd}, the last grid time at which every
 * replicate is still contributing. This is the same commitment P6.08 made for
 * confidence intervals ("displayed honestly with N"): a consumer cannot
 * obtain a band without also receiving the count that produced it.
 *
 * ## Nesting and monotonicity are structural, not asserted after the fact
 *
 * The criterion asks for bands that are nested (`q05 <= q25 <= q50 <= q75 <=
 * q95` at every time) and monotone in the level. Both follow from computing
 * every level from the *same sorted array* with a level-to-index map that is
 * itself monotone -- see {@link quantileOfSorted}. Nothing clamps or repairs
 * the output afterwards, because a repair would hide the only kind of bug
 * that could produce a crossing. The tests assert the property on real
 * ensembles anyway; a structural argument that is never checked is a comment.
 */

import type { Trajectory } from "@ballista/solverkit";

/**
 * The five levels the task names. Ascending, which
 * {@link buildEnsembleFan} requires of any level set.
 */
export const DEFAULT_FAN_LEVELS: readonly number[] = Object.freeze([0.05, 0.25, 0.5, 0.75, 0.95]);

/**
 * The `p`-quantile of an already-sorted ascending sample, by linear
 * interpolation between order statistics -- the estimator NumPy's
 * `percentile` and R's `quantile(type = 7)` use by default.
 *
 * `h = (n - 1) p` is the fractional index; the result is the linear blend of
 * the two order statistics either side of it. Two properties of that map are
 * what the band nesting rests on: it is **non-decreasing in `p`** (the index
 * is, and the sorted array is), and it is **exact at the ends** (`p = 0`
 * returns the minimum and `p = 1` the maximum, with no rounding, since `h` is
 * then an exact integer).
 *
 * Chosen over the "nearest order statistic" family because a fan chart is
 * read as a continuous surface: a nearest-rank estimator makes the band jump
 * by a whole order statistic as the surviving count changes by one, which
 * draws a staircase where the ensemble has none.
 *
 * @param sorted ascending, length >= 1. Not checked -- this is the inner loop
 *   of a per-grid-point reduction and {@link buildEnsembleFan} sorts.
 * @param p in `[0, 1]`.
 */
export function quantileOfSorted(sorted: ArrayLike<number>, p: number): number {
  const n = sorted.length;
  if (n === 0) return Number.NaN;
  if (n === 1) return sorted[0] as number;
  const h = (n - 1) * p;
  const lo = Math.floor(h);
  if (lo >= n - 1) return sorted[n - 1] as number;
  const frac = h - lo;
  const a = sorted[lo] as number;
  const b = sorted[lo + 1] as number;
  // `a + frac*(b - a)` rather than `(1-frac)*a + frac*b`: with frac exactly 0
  // this returns `a` bit for bit, which is what makes a grid point that
  // coincides with an order statistic reproduce it exactly.
  return a + frac * (b - a);
}

/** Which channel to resample, and what to interpolate it with. */
export interface ResampleOptions {
  /** Index into `Trajectory.channels` of the quantity being resampled. */
  readonly valueChannel: number;
  /**
   * Index of the channel holding `d(valueChannel)/dt`, when one exists.
   *
   * Supplying it selects **cubic Hermite** interpolation (third-order, the
   * same interpolant `HermiteDenseOutputStepper` builds); omitting it selects
   * linear (second-order). There is deliberately no default and no guess: a
   * wrong derivative channel produces a smooth, plausible curve that is not
   * the solution, which is far worse than the honest linear fallback.
   */
  readonly derivativeChannel?: number;
}

/**
 * Resamples one channel of one trajectory onto `grid`.
 *
 * Grid times outside the trajectory's own `[t[0], t[nSteps-1]]` yield `NaN`
 * -- **not** a clamped endpoint value. A replicate that landed at 8.2 s has
 * no position at 9 s, and repeating its impact point across the rest of the
 * grid would draw a flat tail that reads as a projectile resting on the
 * ground; worse, it would drag the ensemble's quantiles towards it.
 * {@link buildEnsembleFan} counts those `NaN`s rather than averaging them.
 *
 * A `NaN` in a recorded row takes out **both** intervals adjacent to it,
 * including their far endpoints: the interpolation weights the poisoned value
 * by zero there, and `0 * NaN` is `NaN` rather than `0`. That is left as it
 * is rather than special-cased, because the interval either side of an
 * unusable row genuinely has no trustworthy value in it, and a short-circuit
 * returning `y0` at exactly `t0` while returning `NaN` an instant later would
 * be a stranger surface than a clean hole. {@link buildEnsembleFan} thins
 * those columns rather than voiding them.
 *
 * Both arrays are ascending, so the walk is a single merge: O(nSteps + grid),
 * not O(grid · log nSteps).
 *
 * @throws RangeError if a channel index is out of range, or if `grid` is not
 *   strictly ascending and finite.
 */
export function resampleOnGrid(
  trajectory: Trajectory,
  grid: ArrayLike<number>,
  options: ResampleOptions,
): Float64Array {
  const { valueChannel, derivativeChannel } = options;
  const channels = trajectory.channels;
  if (!Number.isInteger(valueChannel) || valueChannel < 0 || valueChannel >= channels.length) {
    throw new RangeError(
      `valueChannel must index one of the ${channels.length} channels, got ${valueChannel}`,
    );
  }
  if (derivativeChannel !== undefined) {
    if (
      !Number.isInteger(derivativeChannel) ||
      derivativeChannel < 0 ||
      derivativeChannel >= channels.length
    ) {
      throw new RangeError(
        `derivativeChannel must index one of the ${channels.length} channels, got ${derivativeChannel}`,
      );
    }
  }
  assertAscendingGrid(grid);

  const t = trajectory.t;
  const n = trajectory.nSteps;
  const y = channels[valueChannel] as Float64Array;
  const dy =
    derivativeChannel === undefined ? undefined : (channels[derivativeChannel] as Float64Array);

  const out = new Float64Array(grid.length);
  if (n === 0) {
    out.fill(Number.NaN);
    return out;
  }
  const tStart = t[0] as number;
  const tEnd = t[n - 1] as number;

  let step = 0;
  for (let g = 0; g < grid.length; g++) {
    const time = grid[g] as number;
    if (time < tStart || time > tEnd) {
      out[g] = Number.NaN;
      continue;
    }
    // Advance to the step whose right endpoint is at or past `time`. `grid` is
    // ascending, so `step` never moves backwards across the whole loop.
    while (step + 1 < n && (t[step + 1] as number) < time) step++;
    if (step + 1 >= n) {
      // `time === tEnd` exactly (anything larger took the NaN branch).
      out[g] = y[n - 1] as number;
      continue;
    }
    const t0 = t[step] as number;
    const t1 = t[step + 1] as number;
    const h = t1 - t0;
    if (h === 0) {
      // A zero-length step (a terminal event localized onto its own left
      // endpoint). No interior to interpolate; the left value is the answer.
      out[g] = y[step] as number;
      continue;
    }
    const theta = (time - t0) / h;
    const y0 = y[step] as number;
    const y1 = y[step + 1] as number;
    if (dy === undefined) {
      out[g] = y0 + theta * (y1 - y0);
      continue;
    }
    out[g] = hermite(y0, y1, (dy[step] as number) * h, (dy[step + 1] as number) * h, theta);
  }
  return out;
}

/**
 * Cubic Hermite on the unit interval from the two endpoint values and the two
 * endpoint slopes *already scaled by the step* (`m = h · dy/dt`), which is
 * the form that makes the basis functions constants:
 *
 * ```
 * H(θ) = (2θ³ − 3θ² + 1)·y0 + (θ³ − 2θ² + θ)·m0 + (−2θ³ + 3θ²)·y1 + (θ³ − θ²)·m1
 * ```
 *
 * Written in Horner form. At `θ = 0` every basis but `y0`'s is exactly zero
 * and `y0`'s is exactly 1, so the endpoints are reproduced bit for bit -- the
 * property a grid point landing on a recorded step relies on.
 */
function hermite(y0: number, y1: number, m0: number, m1: number, theta: number): number {
  const t2 = theta * theta;
  const t3 = t2 * theta;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + theta;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return h00 * y0 + h10 * m0 + h01 * y1 + h11 * m1;
}

function assertAscendingGrid(grid: ArrayLike<number>): void {
  if (grid.length === 0) throw new RangeError("grid must hold at least one time");
  for (let i = 0; i < grid.length; i++) {
    const v = grid[i] as number;
    if (!Number.isFinite(v)) throw new RangeError(`grid[${i}] is not finite: ${v}`);
    if (i > 0 && v <= (grid[i - 1] as number)) {
      throw new RangeError(
        `grid must be strictly ascending; grid[${i}] = ${v} follows ${grid[i - 1]}`,
      );
    }
  }
}

/**
 * A uniform time grid spanning the ensemble: from the earliest start to the
 * latest end, in `pointCount` equally spaced points inclusive of both.
 *
 * The span is the **union**, not the intersection, so the fan covers every
 * replicate's whole flight and the thinning past the first impact is visible
 * rather than cropped away. {@link EnsembleFan.commonSupportEnd} is what a
 * caller reads if it wants the intersection instead.
 *
 * @throws RangeError if `trajectories` is empty, `pointCount < 2`, or the
 *   ensemble's span is not positive.
 */
export function buildCommonGrid(
  trajectories: readonly Trajectory[],
  pointCount: number,
): Float64Array {
  if (trajectories.length === 0) throw new RangeError("need at least one trajectory");
  if (!Number.isInteger(pointCount) || pointCount < 2) {
    throw new RangeError(`pointCount must be an integer >= 2, got ${pointCount}`);
  }
  let start = Number.POSITIVE_INFINITY;
  let end = Number.NEGATIVE_INFINITY;
  for (const trajectory of trajectories) {
    if (trajectory.nSteps === 0) continue;
    start = Math.min(start, trajectory.t[0] as number);
    end = Math.max(end, trajectory.t[trajectory.nSteps - 1] as number);
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || !(end > start)) {
    throw new RangeError(`ensemble spans no positive time interval (start ${start}, end ${end})`);
  }
  const grid = new Float64Array(pointCount);
  const last = pointCount - 1;
  for (let i = 0; i < pointCount; i++) {
    // Endpoint-anchored rather than `start + i*dt` accumulated: the last point
    // is exactly `end`, so a replicate's final recorded row is hit exactly
    // instead of being missed by an ulp and turning into a NaN.
    grid[i] = i === last ? end : start + ((end - start) * i) / last;
  }
  return grid;
}

/** Quantile envelope bands over a common time grid. */
export interface EnsembleFan {
  /** The grid the bands are sampled on. */
  readonly grid: Float64Array;
  /** The levels, ascending, as supplied. */
  readonly levels: readonly number[];
  /**
   * One array per level, parallel to {@link levels}, each of `grid.length`.
   * `bands[k][g]` is the `levels[k]` quantile over the replicates in flight
   * at `grid[g]`, or `NaN` where none is.
   */
  readonly bands: readonly Float64Array[];
  /**
   * How many replicates contributed at each grid point. Never larger than
   * {@link replicateCount}, and non-increasing only for ensembles that all
   * start together -- a fan over staggered launches rises then falls, which
   * is why this is reported rather than derived.
   */
  readonly sampleCount: Int32Array;
  /** Replicates supplied, including any that contributed nowhere. */
  readonly replicateCount: number;
  /**
   * The largest grid time at which **every** replicate still contributed, or
   * `NaN` if no grid point does. Past it the bands are conditional on
   * survival and mean something different; a chart that shades beyond it
   * without saying so is lying by omission.
   */
  readonly commonSupportEnd: number;
}

/** Options for {@link buildEnsembleFan}. */
export interface EnsembleFanOptions extends ResampleOptions {
  /** Ascending levels in `[0, 1]`. Defaults to {@link DEFAULT_FAN_LEVELS}. */
  readonly levels?: readonly number[];
}

/**
 * Resamples every replicate onto `grid` and reduces each grid point to its
 * quantiles.
 *
 * Non-finite resampled values (a replicate outside its own time span, or a
 * channel that went `NaN`) are excluded from that grid point's sample rather
 * than propagating: one `NaN` in a sort would otherwise make every band at
 * that time `NaN`, turning a partially-thinned column into a hole.
 *
 * @throws RangeError if the ensemble is empty, the grid is not strictly
 *   ascending, a channel index is out of range, or the levels are not
 *   ascending values in `[0, 1]`.
 */
export function buildEnsembleFan(
  trajectories: readonly Trajectory[],
  grid: ArrayLike<number>,
  options: EnsembleFanOptions,
): EnsembleFan {
  if (trajectories.length === 0) throw new RangeError("need at least one trajectory");
  assertAscendingGrid(grid);
  const levels = options.levels ?? DEFAULT_FAN_LEVELS;
  assertAscendingLevels(levels);

  const gridCopy = Float64Array.from(grid as ArrayLike<number>);
  const pointCount = gridCopy.length;
  const replicateCount = trajectories.length;

  // Column-major scratch: one contiguous row per grid point, filled by
  // scattering each replicate's resampled series across the rows. Resampling
  // is per-replicate (the merge walk needs the replicate's own ascending
  // times); the reduction is per-grid-point.
  const columns: Float64Array[] = Array.from(
    { length: pointCount },
    () => new Float64Array(replicateCount),
  );
  const sampleCount = new Int32Array(pointCount);
  for (const trajectory of trajectories) {
    const series = resampleOnGrid(trajectory, gridCopy, options);
    for (let g = 0; g < pointCount; g++) {
      const v = series[g] as number;
      if (!Number.isFinite(v)) continue;
      (columns[g] as Float64Array)[sampleCount[g] as number] = v;
      sampleCount[g] = (sampleCount[g] as number) + 1;
    }
  }

  const bands = levels.map(() => new Float64Array(pointCount));
  let commonSupportEnd = Number.NaN;
  for (let g = 0; g < pointCount; g++) {
    const count = sampleCount[g] as number;
    if (count === replicateCount) commonSupportEnd = gridCopy[g] as number;
    if (count === 0) {
      for (const band of bands) band[g] = Number.NaN;
      continue;
    }
    const sorted = (columns[g] as Float64Array).subarray(0, count);
    sorted.sort();
    for (let k = 0; k < levels.length; k++) {
      (bands[k] as Float64Array)[g] = quantileOfSorted(sorted, levels[k] as number);
    }
  }

  return Object.freeze({
    grid: gridCopy,
    levels: Object.freeze([...levels]),
    bands: Object.freeze(bands),
    sampleCount,
    replicateCount,
    commonSupportEnd,
  });
}

function assertAscendingLevels(levels: readonly number[]): void {
  if (levels.length === 0) throw new RangeError("need at least one quantile level");
  for (let i = 0; i < levels.length; i++) {
    const p = levels[i] as number;
    if (!Number.isFinite(p) || p < 0 || p > 1) {
      throw new RangeError(`levels[${i}] must lie in [0, 1], got ${p}`);
    }
    if (i > 0 && !(p > (levels[i - 1] as number))) {
      throw new RangeError(
        `levels must be strictly ascending, so the bands nest by construction; levels[${i}] = ${p} follows ${levels[i - 1]}`,
      );
    }
  }
}
