/**
 * `PlotPane` v1 (§6.2: "Analysis plots (PlotPane): time series (y, v, E,
 * R_E, h_k step-size trace) ... a thin custom canvas plotter for the
 * always-on panes"; P3.29). Two concerns, split like every other layer in
 * this package: pure {@link PlotSeries} derivation from a solve's own
 * recorder outputs (no re-derived physics -- `computeSpeedAndEnergySeries`
 * reuses `hud-readout.ts`'s `computeHudReadout` exactly, one source of
 * truth for "what this state's speed/energy are", mirroring
 * `force-glyphs.ts`/`hud-readout.ts`'s own doc comments on the point), and
 * {@link drawPlotPane}'s thin rendering pass over one series at a time.
 *
 * y and R_E and h(t) need no physics at all -- they're recorder channels
 * (or a channel's residual/step-size trace) verbatim, just relabeled with
 * units for the axis. v and E do need a `model.rhs` refresh per row (E's
 * `mgy` term reads `ctx.env.g`, only meaningful right after that call, see
 * `hud-readout.ts`), so those two are computed together in one pass over
 * the trajectory rather than twice.
 */

import { type EvalContext, type Model } from "@ballista/engine";
import type { InvariantResidualChannel, StepSizeTrace, Trajectory } from "@ballista/solverkit";
import { computeAxisTicks, computeNiceStep, formatTickValue } from "./axes-layer.js";
import { computeHudReadout, createHudReadoutScratch } from "./hud-readout.js";

/** Shared `[x, y, vx, vy]` planar-projectile channel convention (`projectile-layer.ts`/`hud-readout.ts`). */
const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** One plottable time series: a label/unit for axis labeling, plus parallel `t`/`values` arrays. */
export interface PlotSeries {
  readonly label: string;
  readonly unit: string;
  readonly t: Float64Array;
  readonly values: Float64Array;
}

/** Height y(t) read directly from `trajectory`'s own Y channel -- no derivation, so it trivially "matches the recorder channel" (this task's validation criterion). */
export function heightSeries(trajectory: Trajectory): PlotSeries {
  return { label: "y", unit: "m", t: trajectory.t, values: trajectory.channels[Y]! };
}

/** Speed and energy series, computed together from one `model.rhs` refresh per recorded row (`computeHudReadout`, `hud-readout.ts`). */
export interface SpeedAndEnergySeries {
  readonly speed: PlotSeries;
  readonly energy: PlotSeries;
}

/**
 * Speed |v|(t) and mechanical energy E(t), one row of `trajectory` at a
 * time: reconstructs each row's state vector from `trajectory.channels`,
 * refreshes `ctx` via `computeHudReadout` (which itself calls
 * `model.rhs`), and reads `.speed`/`.energy` straight off the result --
 * exactly the same computation `ReadoutLayer`'s live HUD badge uses at a
 * single playhead (P3.15), just run over every recorded row instead of
 * one.
 */
export function computeSpeedAndEnergySeries(
  model: Model,
  trajectory: Trajectory,
  ctx: EvalContext,
): SpeedAndEnergySeries {
  const n = trajectory.nSteps;
  const speedValues = new Float64Array(n);
  const energyValues = new Float64Array(n);
  const scratch = createHudReadoutScratch(model.dim);
  const { channels, t } = trajectory;

  for (let i = 0; i < n; i++) {
    for (let c = 0; c < channels.length; c++) {
      scratch.y[c] = channels[c]![i]!;
    }
    const readout = computeHudReadout(model, t[i]!, scratch.y, ctx, scratch);
    speedValues[i] = readout.speed;
    energyValues[i] = readout.energy;
  }

  return {
    speed: { label: "v", unit: "m/s", t, values: speedValues },
    energy: { label: "E", unit: "J", t, values: energyValues },
  };
}

/** R_E(t) (or any other declared invariant's residual) read directly from `InvariantMonitor`'s own output channel (`invariant-monitor.ts`) -- verbatim, just relabeled for the axis. */
export function invariantResidualSeries(channel: InvariantResidualChannel, unit = "J"): PlotSeries {
  const label = channel.name === "energy" ? "R_E" : `R_${channel.name}`;
  return { label, unit, t: channel.t, values: channel.residual };
}

/** h(t), read directly from `StepSizeRecorder`'s own trace (`step-size-recorder.ts`) -- verbatim, just relabeled for the axis. */
export function stepSizeSeries(trace: StepSizeTrace): PlotSeries {
  return { label: "h", unit: "s", t: trace.t, values: trace.h };
}

/** A screen-space rectangle a `PlotSeries` is drawn into (pane-local, not world/camera coordinates -- see module doc). */
export interface PlotPaneLayout {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** An inclusive numeric range, used for both the time and value axes. */
export interface PlotPaneRange {
  readonly min: number;
  readonly max: number;
}

/**
 * `series.t`'s span -- `TrajectoryRecorder`/`StepSizeRecorder`/
 * `InvariantMonitor` all record in strictly increasing `t` order, so this
 * is just the first/last entries, not a full scan. Empty series (nothing
 * recorded) fall back to `[0, 1]` rather than an inverted/empty range.
 */
export function computeSeriesTimeRange(series: PlotSeries): PlotPaneRange {
  const n = series.t.length;
  if (n === 0) return { min: 0, max: 1 };
  return { min: series.t[0]!, max: series.t[n - 1]! };
}

/**
 * `series.values`'s span, padded slightly when every value is identical
 * (a genuinely flat series, e.g. a drag-free flight's untouched horizontal
 * momentum) so the plot has a nonzero-height range to scale into instead
 * of dividing by a zero span. Empty series fall back to `[0, 1]`.
 */
export function computeSeriesValueRange(series: PlotSeries): PlotPaneRange {
  const n = series.values.length;
  if (n === 0) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = series.values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max > min) return { min, max };

  const pad = min !== 0 ? Math.abs(min) * 0.05 : 1;
  return { min: min - pad, max: max + pad };
}

/** Maps a time value to its pane-local screen x, linearly across `layout.width`. */
export function plotScreenX(t: number, timeRange: PlotPaneRange, layout: PlotPaneLayout): number {
  const span = timeRange.max - timeRange.min;
  const fraction = span === 0 ? 0 : (t - timeRange.min) / span;
  return layout.x + fraction * layout.width;
}

/** The exact inverse of {@link plotScreenX}. */
export function screenXToPlotTime(
  screenX: number,
  timeRange: PlotPaneRange,
  layout: PlotPaneLayout,
): number {
  const fraction = layout.width === 0 ? 0 : (screenX - layout.x) / layout.width;
  return timeRange.min + fraction * (timeRange.max - timeRange.min);
}

/** Maps a series value to its pane-local screen y -- larger values plot higher (smaller screen y), the same up-is-up convention `Camera2D`'s world<->screen transform uses. */
export function plotScreenY(
  value: number,
  valueRange: PlotPaneRange,
  layout: PlotPaneLayout,
): number {
  const span = valueRange.max - valueRange.min;
  const fraction = span === 0 ? 0 : (value - valueRange.min) / span;
  return layout.y + layout.height - fraction * layout.height;
}

/** The exact inverse of {@link plotScreenY}. */
export function screenYToPlotValue(
  screenY: number,
  valueRange: PlotPaneRange,
  layout: PlotPaneLayout,
): number {
  const fraction = layout.height === 0 ? 0 : (layout.y + layout.height - screenY) / layout.height;
  return valueRange.min + fraction * (valueRange.max - valueRange.min);
}

/** One point of `series`, in pane-local screen space. */
export interface PlotScreenPoint {
  readonly x: number;
  readonly y: number;
}

/**
 * `series.t`/`series.values`, one point at a time, mapped into `layout`'s
 * screen rectangle -- the exact geometry {@link drawPlotPane} strokes,
 * and (via {@link screenXToPlotTime}/{@link screenYToPlotValue}) round-trips
 * back to the original data with no distortion, which is what "curves
 * match recorder channels" (this task's validation criterion) means for a
 * linear-scale plot: no resampling, no smoothing, one screen point per
 * recorded row.
 */
export function buildPlotScreenPoints(
  series: PlotSeries,
  layout: PlotPaneLayout,
  timeRange: PlotPaneRange = computeSeriesTimeRange(series),
  valueRange: PlotPaneRange = computeSeriesValueRange(series),
): PlotScreenPoint[] {
  const n = series.t.length;
  const points: PlotScreenPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = {
      x: plotScreenX(series.t[i]!, timeRange, layout),
      y: plotScreenY(series.values[i]!, valueRange, layout),
    };
  }
  return points;
}

/** The subset of `CanvasRenderingContext2D` `drawPlotPane` needs. */
export interface PlotPaneCanvas {
  strokeStyle: string;
  lineWidth: number;
  fillStyle: string;
  font: string;
  textAlign: string;
  textBaseline: string;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  stroke(): void;
  fillText(text: string, x: number, y: number): void;
}

export interface PlotPaneOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly targetTickCount?: number;
  readonly font?: string;
  readonly labelColor?: string;
}

const DEFAULT_PLOT_COLOR = "#1c7ed6";
const DEFAULT_PLOT_LINE_WIDTH = 1.5;
const DEFAULT_LABEL_COLOR = "rgba(64, 64, 64, 0.9)";
const DEFAULT_FONT = "11px sans-serif";
const DEFAULT_TARGET_TICK_COUNT = 4;

/**
 * Draws `series` as a polyline filling `layout`, plus value-axis ticks
 * (left edge, labeled `${value} ${series.unit}` via `axes-layer.ts`'s
 * `formatTickValue` -- "axes correct units", this task's other validation
 * half) and time-axis ticks (bottom edge, labeled in seconds), and a
 * corner label naming the series. Reuses `axes-layer.ts`'s
 * `computeAxisTicks`/`computeNiceStep` for "nice" tick placement rather
 * than re-deriving it -- the same 1-2-5 progression `AxesLayer` uses for
 * the world-space trajectory view, just scaled into this pane's local
 * rectangle instead of camera space. A degenerate (single-point or
 * already-flat) axis draws its curve/label but skips that axis's ticks,
 * matching `computeAxisTicks`'s own `span > 0` requirement.
 */
export function drawPlotPane(
  canvas: PlotPaneCanvas,
  series: PlotSeries,
  layout: PlotPaneLayout,
  options: PlotPaneOptions = {},
): void {
  const targetTickCount = options.targetTickCount ?? DEFAULT_TARGET_TICK_COUNT;
  const timeRange = computeSeriesTimeRange(series);
  const valueRange = computeSeriesValueRange(series);
  const points = buildPlotScreenPoints(series, layout, timeRange, valueRange);

  canvas.strokeStyle = options.color ?? DEFAULT_PLOT_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_PLOT_LINE_WIDTH;
  if (points.length > 0) {
    canvas.beginPath();
    canvas.moveTo(points[0]!.x, points[0]!.y);
    for (let i = 1; i < points.length; i++) {
      canvas.lineTo(points[i]!.x, points[i]!.y);
    }
    canvas.stroke();
  }

  canvas.fillStyle = options.labelColor ?? DEFAULT_LABEL_COLOR;
  canvas.font = options.font ?? DEFAULT_FONT;

  if (valueRange.max > valueRange.min) {
    const step = computeNiceStep(valueRange.min, valueRange.max, targetTickCount);
    canvas.textAlign = "left";
    canvas.textBaseline = "middle";
    for (const tick of computeAxisTicks(valueRange.min, valueRange.max, targetTickCount)) {
      canvas.fillText(
        formatTickValue(tick, step, series.unit),
        layout.x,
        plotScreenY(tick, valueRange, layout),
      );
    }
  }

  if (timeRange.max > timeRange.min) {
    const step = computeNiceStep(timeRange.min, timeRange.max, targetTickCount);
    canvas.textAlign = "center";
    canvas.textBaseline = "top";
    for (const tick of computeAxisTicks(timeRange.min, timeRange.max, targetTickCount)) {
      canvas.fillText(
        formatTickValue(tick, step, "s"),
        plotScreenX(tick, timeRange, layout),
        layout.y + layout.height + 2,
      );
    }
  }

  canvas.textAlign = "left";
  canvas.textBaseline = "alphabetic";
  canvas.fillText(`${series.label} (${series.unit})`, layout.x, layout.y - 4);
}
