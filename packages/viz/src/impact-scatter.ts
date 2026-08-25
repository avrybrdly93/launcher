/**
 * Impact-point displays for a Monte Carlo ensemble (P6.09, §6 phase-6 table:
 * "Impact-point scatter plot (x_impact histogram / 2D scatter in 3D mode)",
 * validation "scatter renders 1e4 pts < 16 ms (density downsample)").
 *
 * The task names two displays because the planar and spatial models land in
 * different-dimensional sets. A planar shot's impact points all lie on the
 * downrange axis, so their distribution is one-dimensional and a histogram is
 * the honest picture of it; a spatial shot's land anywhere on the ground
 * plane, so theirs is two-dimensional and wants a scatter. Both are built
 * here rather than in two modules because they consume the same column --
 * `impactPoint` out of `ObservableSink`, assembled per replicate -- and share
 * this module's one non-obvious commitment, that **a replicate that did not
 * land contributes to neither**.
 *
 * **Nothing here draws.** Both functions return plain typed arrays: bin edges
 * and counts, or screen-space marker positions and the number of replicates
 * each marker stands for. P6.10 and P6.11 render them, and a renderer that
 * wants a density colour ramp reads `counts` and asks `@ballista/runtime` for
 * `viridis` (§6.1's viridis-only rule; this module defines no colormap of its
 * own, which `colormap-enforcement.test.ts` checks).
 *
 * **On the 16 ms in the criterion.** It is one animation frame (§2.6's
 * 16.6 ms), and it is a budget for *rendering*, not for this reduction --
 * which is exactly why the criterion says "density downsample" in the same
 * breath. 1e4 markers is not a drawing problem because 1e4 is a large number;
 * it is a drawing problem because at any useful zoom most of those markers sit
 * on top of each other, so the renderer pays for 1e4 draw calls to show maybe
 * two thousand distinguishable dots. {@link buildImpactScatter} collapses the
 * ensemble to at most one marker per screen cell before the renderer sees it,
 * which bounds the draw count by the *viewport*, not by the replicate count:
 * a 1e6-replicate batch emits no more markers than a 1e4-replicate one. The
 * reduction itself is a single O(n) pass and measures far under the frame
 * budget on its own (see `impact-scatter.test.ts`), which is the point --
 * the budget is meant to be spent on drawing.
 */

import type { Camera2DState, Viewport } from "./camera2d.js";

/** Default number of histogram bins when the caller does not choose (§6.1: a readable default, not a rule). */
export const DEFAULT_IMPACT_BIN_COUNT = 32;

/**
 * Default screen-space cell size for the density downsample, in pixels.
 *
 * 4 px is a little under a typical scatter marker's diameter, so two points
 * that share a cell would have overlapped on screen anyway and collapsing
 * them loses nothing a viewer could have resolved. Larger cells trade
 * fidelity for fewer markers; smaller ones approach one marker per point and
 * give the downsample back.
 */
export const DEFAULT_IMPACT_CELL_PX = 4;

/** Shared options: which replicates count at all. */
interface MaskOption {
  /**
   * Optional per-replicate keep flag, parallel to the value arrays -- a
   * nonzero entry keeps that replicate. Intended for `McObservableColumns`'
   * `landed` column: a replicate that ran out of horizon still has a final
   * row, and reading its position as an "impact point" would put a phantom
   * dot wherever the integration happened to stop. Entries beyond the mask's
   * length are treated as excluded, so a short mask cannot silently admit the
   * tail of a longer column.
   */
  readonly mask?: ArrayLike<number> | undefined;
}

/** One-dimensional impact distribution: the planar model's `x_impact`. */
export interface ImpactHistogram {
  /**
   * Bin boundaries, ascending, length `counts.length + 1`. Bins are half-open
   * `[edge[i], edge[i+1])` except the last, which is closed at both ends so
   * that the domain's maximum lands in it rather than being reported as above
   * the domain.
   */
  readonly binEdges: Float64Array;
  /** Replicates in each bin. */
  readonly counts: Uint32Array;
  /** Sum of {@link counts} -- kept replicates that fell inside the domain. */
  readonly total: number;
  /** Kept replicates below the domain's lower edge (only possible with an explicit `domain`). */
  readonly belowDomain: number;
  /** Kept replicates above the domain's upper edge (only possible with an explicit `domain`). */
  readonly aboveDomain: number;
  /** Replicates dropped before binning: masked out, or not finite. */
  readonly excluded: number;
}

export interface ImpactHistogramOptions extends MaskOption {
  /** Number of bins. Defaults to {@link DEFAULT_IMPACT_BIN_COUNT}. Must be a positive integer. */
  readonly binCount?: number | undefined;
  /**
   * Explicit `[lo, hi)` domain, `lo < hi`. Defaults to the kept data's own
   * min/max. Pass one to hold the axis still while an ensemble grows, or to
   * match a zoomed view -- without it every new replicate that sets a record
   * rescales the whole chart and the bars stop being comparable between
   * frames.
   */
  readonly domain?: readonly [number, number] | undefined;
}

/**
 * Bins `values` into a histogram of impact abscissae.
 *
 * **A degenerate data range collapses to one bin, and that is deliberate.**
 * If every kept value is identical (a zero-variance ensemble, or a single
 * replicate) the data supplies no scale, so any nonzero bin width would be
 * invented by this function and read by a viewer as a spread that is not
 * there. The result is instead a single bin `[v, v]` holding everything --
 * `counts.length` is 1 rather than `binCount` in exactly this case, which is
 * the one place the `binCount` request is not honoured. A caller that wants a
 * fixed axis anyway can say so with `domain`, and then gets its bins.
 *
 * A `domain` whose bounds are not finite or not strictly increasing throws:
 * that is a caller error, not data to be accommodated, and silently repairing
 * it would hide a mis-wired axis.
 */
export function buildImpactHistogram(
  values: ArrayLike<number>,
  options: ImpactHistogramOptions = {},
): ImpactHistogram {
  const binCount = options.binCount ?? DEFAULT_IMPACT_BIN_COUNT;
  if (!Number.isInteger(binCount) || binCount < 1) {
    throw new Error(`buildImpactHistogram: binCount must be a positive integer, got ${binCount}`);
  }

  const n = values.length;
  const mask = options.mask;

  let lo: number;
  let hi: number;
  let excluded = 0;

  if (options.domain !== undefined) {
    [lo, hi] = options.domain;
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(lo < hi)) {
      throw new Error(
        `buildImpactHistogram: domain must be finite and strictly increasing, got [${lo}, ${hi}]`,
      );
    }
    for (let i = 0; i < n; i++) {
      if (!keeps(mask, i) || !Number.isFinite(values[i]!)) excluded++;
    }
  } else {
    // One pass for the data's own extent, counting the drops as it goes so
    // the binning pass below does not have to re-derive them.
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < n; i++) {
      const v = values[i]!;
      if (!keeps(mask, i) || !Number.isFinite(v)) {
        excluded++;
        continue;
      }
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) {
      // Nothing kept at all: an empty histogram over an empty domain, rather
      // than a throw. An ensemble in which no replicate has landed yet is a
      // normal transient state for a live batch, not an error.
      return {
        binEdges: new Float64Array([0, 0]),
        counts: new Uint32Array(1),
        total: 0,
        belowDomain: 0,
        aboveDomain: 0,
        excluded,
      };
    }
    if (min === max) {
      let total = 0;
      for (let i = 0; i < n; i++) {
        if (keeps(mask, i) && Number.isFinite(values[i]!)) total++;
      }
      return {
        binEdges: new Float64Array([min, min]),
        counts: Uint32Array.of(total),
        total,
        belowDomain: 0,
        aboveDomain: 0,
        excluded,
      };
    }
    lo = min;
    hi = max;
  }

  const binEdges = new Float64Array(binCount + 1);
  const width = hi - lo;
  for (let b = 0; b <= binCount; b++) binEdges[b] = lo + (width * b) / binCount;
  // The arithmetic above can land the last edge a rounding step off `hi`;
  // pinning it exactly keeps the closed-last-bin rule below honest.
  binEdges[binCount] = hi;

  const counts = new Uint32Array(binCount);
  let total = 0;
  let belowDomain = 0;
  let aboveDomain = 0;

  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (!keeps(mask, i) || !Number.isFinite(v)) continue;
    if (v < lo) {
      belowDomain++;
      continue;
    }
    if (v > hi) {
      aboveDomain++;
      continue;
    }
    // `Math.min` closes the last bin: `v === hi` would otherwise index one
    // past the end and be lost, which is the classic off-by-one that quietly
    // drops the single most extreme replicate from every chart.
    const bin = Math.min(Math.floor(((v - lo) / width) * binCount), binCount - 1);
    counts[bin]!++;
    total++;
  }

  return { binEdges, counts, total, belowDomain, aboveDomain, excluded };
}

/** Two-dimensional impact distribution, downsampled to one marker per screen cell. */
export interface ImpactScatter {
  /** Screen x of each marker: the first kept point that fell in that cell. */
  readonly screenXs: Float64Array;
  /** Screen y of each marker, matching {@link screenXs}. */
  readonly screenYs: Float64Array;
  /** Replicates the marker at the same index stands for. Always at least 1. */
  readonly counts: Uint32Array;
  /** Largest entry of {@link counts}, or 0 when nothing was plotted -- a density ramp's normaliser. */
  readonly maxCount: number;
  /** Sum of {@link counts}: kept replicates that landed inside the viewport. */
  readonly kept: number;
  /** Kept replicates whose screen position fell outside the viewport. */
  readonly culled: number;
  /** Replicates dropped before projection: masked out, or not finite. */
  readonly excluded: number;
}

export interface ImpactScatterOptions extends MaskOption {
  /** Screen-space cell size in pixels. Defaults to {@link DEFAULT_IMPACT_CELL_PX}. Must be finite and > 0. */
  readonly cellPx?: number | undefined;
}

/**
 * Projects ground-plane impact points to screen space and collapses them to at
 * most one marker per `cellPx` × `cellPx` cell, carrying each cell's replicate
 * count so the density survives the collapse.
 *
 * `worldXs`/`worldYs` are the two *horizontal* components of `impactPoint` for
 * a spatial layout -- downrange and cross-range. They are named for the screen
 * axes rather than the world ones because that is what {@link Camera2DState}
 * maps; which world axis a caller puts on which screen axis is the caller's
 * framing choice, and this module does not need to know.
 *
 * **What the count is, and what it is not.** `counts[i]` is the number of kept
 * replicates in that cell, and it is invariant under permuting the input --
 * that is the property that lets a viewer read density off the markers.
 * `screenXs[i]`/`screenYs[i]` are *not* permutation-invariant: they are
 * whichever kept point reached the cell first, so a reordered input can move a
 * marker within its own cell, by strictly less than `cellPx`. Choosing the
 * cell's centroid instead would be permutation-invariant, and is wrong here:
 * a centroid is a position no replicate occupies, and this chart's whole
 * subject is where replicates actually land.
 *
 * **Off-viewport points are culled, not clamped**, and reported separately.
 * Clamping would pile every long shot onto the viewport edge and invent a
 * dense band there; the honest report is that they are off-screen, and
 * `culled` lets a caller say so.
 *
 * The cell grid is allocated per call at viewport size (a 1200 × 800 viewport
 * at the default 4 px is 60,000 cells), not per point. That is the shape of
 * the whole optimisation: cost is bounded by the viewport plus one O(n) pass,
 * so the marker count -- and therefore the render cost the 16 ms criterion is
 * about -- stops growing with the ensemble.
 */
export function buildImpactScatter(
  worldXs: ArrayLike<number>,
  worldYs: ArrayLike<number>,
  camera: Camera2DState,
  viewport: Viewport,
  options: ImpactScatterOptions = {},
): ImpactScatter {
  const cellPx = options.cellPx ?? DEFAULT_IMPACT_CELL_PX;
  if (!Number.isFinite(cellPx) || cellPx <= 0) {
    throw new Error(`buildImpactScatter: cellPx must be finite and positive, got ${cellPx}`);
  }
  if (worldXs.length !== worldYs.length) {
    throw new Error(
      `buildImpactScatter: coordinate arrays must be the same length, got ${worldXs.length} and ${worldYs.length}`,
    );
  }

  const n = worldXs.length;
  const mask = options.mask;
  const { width, height } = viewport;

  if (!(width > 0) || !(height > 0)) {
    // A zero-area viewport (a collapsed pane, a chart laid out before its
    // container has a size) culls everything rather than dividing by zero.
    let excludedOnly = 0;
    for (let i = 0; i < n; i++) {
      if (!keeps(mask, i) || !Number.isFinite(worldXs[i]!) || !Number.isFinite(worldYs[i]!)) {
        excludedOnly++;
      }
    }
    return emptyScatter(excludedOnly, n - excludedOnly);
  }

  const cols = Math.max(1, Math.ceil(width / cellPx));
  const rows = Math.max(1, Math.ceil(height / cellPx));
  const cellCounts = new Uint32Array(cols * rows);
  // `firstIndex + 1`, so 0 means "empty" and no separate occupancy array is
  // needed; `n` is bounded by array length so the increment cannot overflow.
  const firstPlusOne = new Uint32Array(cols * rows);

  // Inlines `worldToScreen`'s formula rather than calling it per point, for
  // the same reason `buildDecimatedTrajectoryPath` does: the per-call `{x, y}`
  // this hot path would otherwise allocate is the dominant cost at 1e4 points.
  // Must be kept in exact sync with `worldToScreen` in camera2d.ts.
  const halfWidth = width / 2;
  const halfHeight = height / 2;

  let occupied = 0;
  let kept = 0;
  let culled = 0;
  let excluded = 0;

  for (let i = 0; i < n; i++) {
    const wx = worldXs[i]!;
    const wy = worldYs[i]!;
    if (!keeps(mask, i) || !Number.isFinite(wx) || !Number.isFinite(wy)) {
      excluded++;
      continue;
    }
    const sx = halfWidth + (wx - camera.centerX) * camera.scaleX;
    const sy = halfHeight - (wy - camera.centerY) * camera.scaleY;
    if (sx < 0 || sx >= width || sy < 0 || sy >= height) {
      culled++;
      continue;
    }
    // `Math.min` guards the boundary the same way the histogram's does: a
    // point exactly on the right or bottom edge is already excluded by the
    // half-open test above, but floating-point division can still round a
    // point just inside it up to `cols`/`rows`.
    const col = Math.min((sx / cellPx) | 0, cols - 1);
    const row = Math.min((sy / cellPx) | 0, rows - 1);
    const cell = row * cols + col;
    if (cellCounts[cell] === 0) {
      firstPlusOne[cell] = i + 1;
      occupied++;
    }
    cellCounts[cell]!++;
    kept++;
  }

  const screenXs = new Float64Array(occupied);
  const screenYs = new Float64Array(occupied);
  const counts = new Uint32Array(occupied);
  let maxCount = 0;
  let w = 0;
  // Row-major over the cells rather than in input order, so the output is a
  // deterministic function of which cells are occupied: two callers that
  // shuffled the same ensemble differently get markers in the same sequence.
  for (let cell = 0; cell < cellCounts.length; cell++) {
    const c = cellCounts[cell]!;
    if (c === 0) continue;
    const source = firstPlusOne[cell]! - 1;
    screenXs[w] = halfWidth + (worldXs[source]! - camera.centerX) * camera.scaleX;
    screenYs[w] = halfHeight - (worldYs[source]! - camera.centerY) * camera.scaleY;
    counts[w] = c;
    if (c > maxCount) maxCount = c;
    w++;
  }

  return { screenXs, screenYs, counts, maxCount, kept, culled, excluded };
}

function keeps(mask: ArrayLike<number> | undefined, i: number): boolean {
  if (mask === undefined) return true;
  return i < mask.length && mask[i] !== 0;
}

function emptyScatter(excluded: number, culled: number): ImpactScatter {
  return {
    screenXs: new Float64Array(0),
    screenYs: new Float64Array(0),
    counts: new Uint32Array(0),
    maxCount: 0,
    kept: 0,
    culled,
    excluded,
  };
}
