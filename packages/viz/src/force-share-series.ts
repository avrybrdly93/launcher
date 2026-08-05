/**
 * Force-magnitude stacked-area plot over a whole flight (§6.2 analysis
 * plots; P4.35). `force-glyphs.ts` answers "which forces act *right now*,
 * and which way do they point" at a single playhead; this module answers
 * the complementary question over the entire trajectory -- how the balance
 * between F_g, F_d and F_M *shifts* as the projectile slows, which is where
 * a drag-dominated launch visibly hands over to a gravity-dominated
 * descent.
 *
 * **Why the shares are projections, not magnitudes.** The obvious reading
 * of "force shares" is each |F_i| stacked up. That cannot work, and the
 * task's own validation criterion ("shares sum to |ΣF| within 1e-12") is
 * what rules it out: by the triangle inequality Σ|F_i| >= |ΣF|, with
 * equality only when every force happens to be parallel and same-signed.
 * On any real trajectory drag opposes gravity's horizontal work and the
 * gap is enormous, not a 1e-12 rounding matter. So a share here is the
 * *signed scalar projection* of F_i onto the resultant's own unit
 * direction n̂ = ΣF/|ΣF|:
 *
 *   share_i = F_i · n̂     and     Σ_i share_i = (Σ_i F_i) · n̂ = |ΣF|
 *
 * That identity is exact in real arithmetic, so 1e-12 is measuring
 * floating-point roundoff and nothing else -- the criterion is a genuine
 * self-check on the decomposition rather than a modelling tolerance. It
 * also makes the plot mean something physical: a band is how much that
 * force contributes *along the direction the projectile is actually being
 * accelerated*, so a force fighting the resultant reads as a negative
 * band, which is the honest picture. Drag during ascent is exactly that
 * case.
 *
 * Per-force vectors come from {@link computeForceGlyphs}, not from a
 * second traversal of the force registry -- the same single-source-of-truth
 * rule `force-glyphs.ts` and `plot-pane.ts` both document, so the bands in
 * this plot and the arrows in the glyph layer can never disagree about
 * what a force did.
 */

import type { EvalContext, Model, ForceModel } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import {
  computeForceGlyphs,
  createForceGlyphScratch,
  DEFAULT_FORCE_GLYPH_COLORS,
} from "./force-glyphs.js";
import {
  computeSeriesTimeRange,
  plotScreenX,
  plotScreenY,
  type PlotPaneLayout,
  type PlotPaneRange,
  type PlotSeries,
} from "./plot-pane.js";

/**
 * One force's band across the flight: its signed share per recorded row,
 * plus the cumulative `lower`/`upper` stack edges the area is filled
 * between. `lower`/`upper` are pure layout (see {@link stackForceShares});
 * `share` is the physics.
 */
export interface ForceShareBand {
  readonly id: string;
  /** `F_i · n̂` at each recorded row, in newtons. Negative where this force opposes the resultant. */
  readonly share: Float64Array;
  /**
   * `|F_i|` at each recorded row -- the force's own magnitude, independent
   * of the resultant's direction. Carried alongside `share` because the two
   * can diverge enormously: at terminal velocity the resultant is purely
   * horizontal, so gravity's `share` is exactly `0` while its `magnitude`
   * is still `mg`. Readouts want the magnitude; the stack needs the share.
   */
  readonly magnitude: Float64Array;
  /** Bottom edge of this band's filled area. Always `<= upper`. */
  readonly lower: Float64Array;
  /**
   * Top edge of this band's filled area. The band's geometric height is
   * `upper - lower = |share|`, *not* `lower + share`: a negative share is
   * drawn as a positive-height band hanging below zero (see
   * {@link stackForceShares}), so the sign lives in `share` and in which
   * side of the baseline the band sits on, never in an inverted rectangle.
   */
  readonly upper: Float64Array;
}

/** Every wired force's band over one trajectory, plus the |ΣF| the bands must sum to. */
export interface ForceShareSeries {
  readonly t: Float64Array;
  readonly bands: readonly ForceShareBand[];
  /** `|ΣF|` at each recorded row -- read from `ctx.forceAccum` via the glyph set, never re-summed here. */
  readonly resultantMagnitude: Float64Array;
  readonly unit: string;
}

/**
 * Lays the already-computed shares out as a *diverging* stack: positive
 * shares stack upward from zero, negative shares stack downward from zero.
 * The alternative -- one running cursor for both signs -- makes a band
 * whose share flips sign mid-flight (drag does, relative to the resultant,
 * around apex) fold back over the band beneath it and render as an
 * unreadable ribbon.
 *
 * The stack's net top, `Σ positive + Σ negative`, is Σ_i share_i and so is
 * still exactly `|ΣF|`: splitting the layout by sign reorders the addition
 * but adds nothing and drops nothing.
 */
function stackForceShares(
  shares: readonly Float64Array[],
  n: number,
): { lower: Float64Array; upper: Float64Array }[] {
  const edges = shares.map(() => ({ lower: new Float64Array(n), upper: new Float64Array(n) }));

  for (let i = 0; i < n; i++) {
    let positiveCursor = 0;
    let negativeCursor = 0;
    for (let b = 0; b < shares.length; b++) {
      const value = shares[b]![i]!;
      const edge = edges[b]!;
      if (value >= 0) {
        edge.lower[i] = positiveCursor;
        positiveCursor += value;
        edge.upper[i] = positiveCursor;
      } else {
        edge.upper[i] = negativeCursor;
        negativeCursor += value;
        edge.lower[i] = negativeCursor;
      }
    }
  }

  return edges;
}

/**
 * Every wired force's share of the resultant at every recorded row of
 * `trajectory`, stacked for area rendering. Reconstructs each row's state
 * vector from `trajectory.channels` and hands it to
 * {@link computeForceGlyphs}, exactly as `computeSpeedAndEnergySeries`
 * (`plot-pane.ts`) drives `computeHudReadout` over the same rows -- one
 * `model.rhs` refresh per row, no physics re-derived locally.
 *
 * Two rows have no direction to project onto, and they are deliberately
 * *not* treated alike:
 *
 * - `|ΣF|` exactly zero (perfectly balanced forces) is a physically real
 *   state. Every share there is `0`, which still satisfies
 *   `Σ share = 0 = |ΣF|` rather than producing `NaN`.
 * - `|ΣF|` non-finite means the *solve* diverged before this module ever
 *   saw it -- an explicit stepper run past its stability limit on a stiff
 *   scenario overflows to `Infinity` (the dust grain does exactly this
 *   under RK4 at h=0.01). Shares there are `NaN`. Zeroing them instead
 *   would report a tidy `Σ share = 0` against an infinite resultant, i.e.
 *   silently break the closure identity this module exists to guarantee
 *   and make a diverged solve look like a converged one. `NaN` propagates
 *   into {@link forceShareClosureResidual}, so the failure stays visible.
 */
export function computeForceShareSeries(
  model: Model,
  forces: readonly ForceModel[],
  trajectory: Trajectory,
  ctx: EvalContext,
): ForceShareSeries {
  const n = trajectory.nSteps;
  const scratch = createForceGlyphScratch(model.dim);
  const { channels, t } = trajectory;

  const shares = forces.map(() => new Float64Array(n));
  const magnitudes = forces.map(() => new Float64Array(n));
  const resultantMagnitude = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels.length; c++) {
      scratch.y[c] = channels[c]![i]!;
    }
    const glyphSet = computeForceGlyphs(model, forces, t[i]!, scratch.y, ctx, scratch);
    const magnitude = glyphSet.resultant.magnitude;
    resultantMagnitude[i] = magnitude;

    for (let b = 0; b < glyphSet.forces.length; b++) {
      magnitudes[b]![i] = glyphSet.forces[b]!.magnitude;
    }

    if (!Number.isFinite(magnitude)) {
      // Diverged solve: refuse to invent a decomposition (see module doc).
      for (let b = 0; b < shares.length; b++) {
        shares[b]![i] = Number.NaN;
      }
      continue;
    }

    if (magnitude === 0) {
      continue; // shares stay 0; Σ share = 0 = |ΣF| holds for this row.
    }

    const nx = glyphSet.resultant.fx / magnitude;
    const ny = glyphSet.resultant.fy / magnitude;
    for (let b = 0; b < glyphSet.forces.length; b++) {
      const force = glyphSet.forces[b]!;
      shares[b]![i] = force.fx * nx + force.fy * ny;
    }
  }

  const edges = stackForceShares(shares, n);
  const bands: ForceShareBand[] = forces.map((force, b) => ({
    id: force.id,
    share: shares[b]!,
    magnitude: magnitudes[b]!,
    lower: edges[b]!.lower,
    upper: edges[b]!.upper,
  }));

  return { t, bands, resultantMagnitude, unit: "N" };
}

/**
 * The largest absolute mismatch between `Σ_i share_i` and `|ΣF|` across
 * every row -- P4.35's validation criterion expressed as a number rather
 * than an assertion, so callers (and the Solver Lab exhibit) can display
 * the residual instead of merely trusting it. Returns `0` for an empty
 * series, and `NaN` if any row's shares are `NaN` (a diverged solve, see
 * module doc) -- the comparison below is written negated precisely so a
 * `NaN` row propagates instead of being skipped, which a plain
 * `residual > worst` would do silently.
 */
export function forceShareClosureResidual(series: ForceShareSeries): number {
  let worst = 0;
  for (let i = 0; i < series.resultantMagnitude.length; i++) {
    let sum = 0;
    for (const band of series.bands) {
      sum += band.share[i]!;
    }
    const residual = Math.abs(sum - series.resultantMagnitude[i]!);
    if (!(residual <= worst)) {
      worst = residual;
    }
  }
  return worst;
}

/** `|ΣF|(t)` as a plain {@link PlotSeries}, so the resultant outline can be drawn by `plot-pane.ts`'s existing polyline path. */
export function resultantMagnitudeSeries(series: ForceShareSeries): PlotSeries {
  return { label: "|ΣF|", unit: series.unit, t: series.t, values: series.resultantMagnitude };
}

/**
 * Value-axis range covering every band edge *and* zero. Zero must be
 * included even when no share is negative: the stack is measured from it,
 * so a range that floated off the baseline would make the bands' heights
 * read as larger than the forces they represent.
 */
export function computeForceShareValueRange(series: ForceShareSeries): PlotPaneRange {
  let min = 0;
  let max = 0;
  for (const band of series.bands) {
    for (let i = 0; i < band.lower.length; i++) {
      const lower = band.lower[i]!;
      const upper = band.upper[i]!;
      if (lower < min) min = lower;
      if (upper < min) min = upper;
      if (lower > max) max = lower;
      if (upper > max) max = upper;
    }
  }
  return min === max ? { min, max: min + 1 } : { min, max };
}

/** The subset of `CanvasRenderingContext2D` {@link drawForceShareStack} needs -- a filled area needs `closePath`/`fill`, which `PlotPaneCanvas` (polylines only) does not carry. */
export interface ForceShareCanvas {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  fill(): void;
  stroke(): void;
}

export interface ForceShareStackOptions {
  /** Per-force-id fill color; defaults to `force-glyphs.ts`'s `DEFAULT_FORCE_GLYPH_COLORS` so a band matches its arrow. */
  readonly colors?: Readonly<Record<string, string>>;
  readonly fallbackColor?: string;
  /** Stroke color for the `|ΣF|` outline; omit to skip drawing it. */
  readonly resultantColor?: string;
  readonly resultantLineWidth?: number;
}

/** Band fills reuse the glyph-arrow palette verbatim, so a band and its arrow are the same color for the same force. */
const DEFAULT_FORCE_SHARE_COLORS = DEFAULT_FORCE_GLYPH_COLORS;

const DEFAULT_FALLBACK_COLOR = "#adb5bd";
const DEFAULT_RESULTANT_LINE_WIDTH = 1.5;

/**
 * Fills one closed polygon per band -- forward along `upper`, back along
 * `lower` -- into `layout`, then optionally strokes `|ΣF|` over the top as
 * the reference the bands sum to. Screen mapping goes through
 * `plot-pane.ts`'s `plotScreenX`/`plotScreenY`, so this stack shares its
 * axes and its no-resampling guarantee (one screen point per recorded row)
 * with every other pane in the panel.
 */
export function drawForceShareStack(
  canvas: ForceShareCanvas,
  series: ForceShareSeries,
  layout: PlotPaneLayout,
  options: ForceShareStackOptions = {},
  timeRange: PlotPaneRange = computeSeriesTimeRange(resultantMagnitudeSeries(series)),
  valueRange: PlotPaneRange = computeForceShareValueRange(series),
): void {
  const n = series.t.length;
  if (n === 0) {
    return;
  }

  const colors = options.colors ?? DEFAULT_FORCE_SHARE_COLORS;
  for (const band of series.bands) {
    canvas.fillStyle = colors[band.id] ?? options.fallbackColor ?? DEFAULT_FALLBACK_COLOR;
    canvas.beginPath();
    canvas.moveTo(
      plotScreenX(series.t[0]!, timeRange, layout),
      plotScreenY(band.upper[0]!, valueRange, layout),
    );
    for (let i = 1; i < n; i++) {
      canvas.lineTo(
        plotScreenX(series.t[i]!, timeRange, layout),
        plotScreenY(band.upper[i]!, valueRange, layout),
      );
    }
    for (let i = n - 1; i >= 0; i--) {
      canvas.lineTo(
        plotScreenX(series.t[i]!, timeRange, layout),
        plotScreenY(band.lower[i]!, valueRange, layout),
      );
    }
    canvas.closePath();
    canvas.fill();
  }

  if (options.resultantColor !== undefined) {
    canvas.strokeStyle = options.resultantColor;
    canvas.lineWidth = options.resultantLineWidth ?? DEFAULT_RESULTANT_LINE_WIDTH;
    canvas.beginPath();
    canvas.moveTo(
      plotScreenX(series.t[0]!, timeRange, layout),
      plotScreenY(series.resultantMagnitude[0]!, valueRange, layout),
    );
    for (let i = 1; i < n; i++) {
      canvas.lineTo(
        plotScreenX(series.t[i]!, timeRange, layout),
        plotScreenY(series.resultantMagnitude[i]!, valueRange, layout),
      );
    }
    canvas.stroke();
  }
}
