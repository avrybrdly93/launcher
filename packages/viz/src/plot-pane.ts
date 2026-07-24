/**
 * `PlotPane` v1 (§6.2: "Analysis plots (PlotPane): time series ($y$, $v$,
 * $E$, $\mathcal R_E$, $h_k$ step-size trace) ... a thin custom canvas
 * plotter for the always-on panes"; P3.29).
 *
 * Every curve this pane draws is a {@link PlotSeries}: a plain `(t, value)`
 * pair of `Float64Array`s plus a unit label -- one uniform shape regardless
 * of where the numbers came from. `y` and `|v|` are read directly off a
 * `Trajectory`'s own recorded channels ({@link stateChannelSeries}); `E` is
 * derived per row via `mechanicalEnergy` ({@link energySeries}) mirroring
 * `hud-readout.ts`'s "refresh `ctx` via `model.rhs`, then derive" pattern,
 * just looped over every recorded row instead of one playhead sample; `R_E`
 * and `h(t)` are `InvariantMonitor`/`StepSizeRecorder`'s own sink outputs,
 * wrapped ({@link residualSeries}, {@link stepSizeSeries}) rather than
 * recomputed -- there is exactly one source of truth for each curve, so
 * "curves match recorder channels" (this task's validation criterion) holds
 * by construction, not by a second parallel calculation that could drift.
 *
 * Axis ticks reuse `axes-layer.ts`'s `computeAxisTicks`/`formatTickValue`
 * directly -- both already operate on plain `[min, max]` ranges with no
 * `Camera2D` dependency, so the same adaptive 1-2-5 ticks and `" unit"`
 * suffix formatting that anchors the world view also anchors a plot's axes
 * (this task's other validation half, "axes correct units").
 */

import { mechanicalEnergy, type EvalContext, type Model } from "@ballista/engine";
import type { InvariantResidualChannel, StepSizeTrace, Trajectory } from "@ballista/solverkit";
import { computeAxisTicks, computeNiceStep, formatTickValue } from "./axes-layer.js";

const X = 0;
const Y = 1;
const VX = 2;
const VY = 3;

/** One plottable time series: `t[i]`/`values[i]` pairs, plus the unit `values` is expressed in. */
export interface PlotSeries {
  readonly name: string;
  readonly unit: string;
  readonly t: Float64Array;
  readonly values: Float64Array;
}

/** Preallocated scratch {@link energySeries} needs -- reused across the row loop so it allocates nothing but the two returned series (§6.5). */
export interface PlotSeriesScratch {
  readonly y: Float64Array;
  readonly rhsOut: Float64Array;
}

/** Allocates a {@link PlotSeriesScratch} sized for a model of the given dimension; call once per mount. */
export function createPlotSeriesScratch(dim: number): PlotSeriesScratch {
  return { y: new Float64Array(dim), rhsOut: new Float64Array(dim) };
}

/**
 * `y(t)` and `|v|(t)`, read directly from `trajectory`'s own `Y`/`VX`/`VY`
 * channels (`|v|` derived by a plain `Math.hypot`, no model evaluation
 * needed since speed doesn't depend on the environment). Shares
 * `trajectory.t` across both series rather than copying it.
 */
export function stateChannelSeries(trajectory: Trajectory): {
  readonly height: PlotSeries;
  readonly speed: PlotSeries;
} {
  const { channels, t, nSteps } = trajectory;
  const speedValues = new Float64Array(nSteps);
  for (let i = 0; i < nSteps; i++) {
    speedValues[i] = Math.hypot(channels[VX]![i]!, channels[VY]![i]!);
  }
  return {
    height: { name: "y", unit: "m", t, values: channels[Y]! },
    speed: { name: "|v|", unit: "m/s", t, values: speedValues },
  };
}

/**
 * `E(t)` = mechanical energy at every recorded row: refreshes `ctx` via
 * `model.rhs` for each row (so `ctx.env.g` reflects that row's own state,
 * exactly the way `computeHudReadout` refreshes it for a single playhead
 * sample) before calling the same `mechanicalEnergy` the engine itself
 * exposes.
 */
export function energySeries(
  model: Model,
  trajectory: Trajectory,
  ctx: EvalContext,
  scratch: PlotSeriesScratch,
): PlotSeries {
  const { channels, t, nSteps } = trajectory;
  const values = new Float64Array(nSteps);

  for (let i = 0; i < nSteps; i++) {
    scratch.y[X] = channels[X]![i]!;
    scratch.y[Y] = channels[Y]![i]!;
    scratch.y[VX] = channels[VX]![i]!;
    scratch.y[VY] = channels[VY]![i]!;
    model.rhs(t[i]!, scratch.y, scratch.rhsOut, ctx);
    values[i] = mechanicalEnergy(scratch.y, ctx);
  }

  return { name: "E", unit: "J", t, values };
}

/** Wraps an `InvariantMonitor` residual channel as a {@link PlotSeries} -- no recomputation, just a name/unit label on the sink's own arrays. */
export function residualSeries(channel: InvariantResidualChannel): PlotSeries {
  return { name: `R_${channel.name}`, unit: "J", t: channel.t, values: channel.residual };
}

/** Wraps a `StepSizeRecorder` trace as a {@link PlotSeries} -- the h(t) step-size curve, straight from the sink. */
export function stepSizeSeries(trace: StepSizeTrace): PlotSeries {
  return { name: "h", unit: "s", t: trace.t, values: trace.h };
}

/** The data-space `[minT, maxT] x [minValue, maxValue]` a series spans -- what `drawPlotPane` autoscales its axes to. */
export interface PlotBounds {
  readonly minT: number;
  readonly maxT: number;
  readonly minValue: number;
  readonly maxValue: number;
}

/** Min/max of `series.t` and `series.values` -- a degenerate (single-point or constant) series still returns a valid nonzero span (padded by 1 unit) so downstream scaling never divides by zero. */
export function computeSeriesBounds(series: PlotSeries): PlotBounds {
  let minT = Infinity;
  let maxT = -Infinity;
  let minValue = Infinity;
  let maxValue = -Infinity;

  for (let i = 0; i < series.t.length; i++) {
    const t = series.t[i]!;
    const v = series.values[i]!;
    if (t < minT) minT = t;
    if (t > maxT) maxT = t;
    if (v < minValue) minValue = v;
    if (v > maxValue) maxValue = v;
  }

  if (!(maxT > minT)) {
    minT -= 0.5;
    maxT += 0.5;
  }
  if (!(maxValue > minValue)) {
    minValue -= 0.5;
    maxValue += 0.5;
  }

  return { minT, maxT, minValue, maxValue };
}

/** The screen-pixel rectangle `drawPlotPane` renders a series into. */
export interface PlotRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * Maps one `(t, value)` data point into `rect`'s pixel space under
 * `bounds`: `t` increases rightward (`minT` at `rect.x`, `maxT` at
 * `rect.x + rect.width`), `value` increases *upward* (`minValue` at the
 * rect's bottom, `maxValue` at its top) -- the same "y flips, x doesn't"
 * convention `camera2d.ts` uses for world-to-screen, just for an
 * independent per-pane data range instead of a shared pannable/zoomable
 * camera.
 */
export function plotDataToPixel(
  bounds: PlotBounds,
  rect: PlotRect,
  t: number,
  value: number,
): { x: number; y: number } {
  const tSpan = bounds.maxT - bounds.minT;
  const vSpan = bounds.maxValue - bounds.minValue;
  return {
    x: rect.x + ((t - bounds.minT) / tSpan) * rect.width,
    y: rect.y + rect.height - ((value - bounds.minValue) / vSpan) * rect.height,
  };
}

/** The subset of `CanvasRenderingContext2D` `drawPlotPane` needs (mirrors `AxesLayerCanvas`). */
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
  readonly targetTickCount?: number;
  readonly curveColor?: string;
  readonly axisColor?: string;
  readonly labelColor?: string;
  readonly font?: string;
}

const DEFAULT_TARGET_TICK_COUNT = 4;
const DEFAULT_CURVE_COLOR = "#1c7ed6";
const DEFAULT_AXIS_COLOR = "rgba(128, 128, 128, 0.4)";
const DEFAULT_LABEL_COLOR = "rgba(64, 64, 64, 0.9)";
const DEFAULT_FONT = "10px sans-serif";

/**
 * Draws one `series` into `rect`: y-axis ticks (adaptive, `series.unit`
 * labeled via `formatTickValue`) along the left edge, then the series'
 * polyline scaled by {@link plotDataToPixel}. A series with fewer than 2
 * points draws only its axis (nothing to connect).
 */
export function drawPlotPane(
  canvas: PlotPaneCanvas,
  rect: PlotRect,
  series: PlotSeries,
  options: PlotPaneOptions = {},
): void {
  const targetTickCount = options.targetTickCount ?? DEFAULT_TARGET_TICK_COUNT;
  const bounds = computeSeriesBounds(series);

  const step = computeNiceStep(bounds.minValue, bounds.maxValue, targetTickCount);
  const ticks = computeAxisTicks(bounds.minValue, bounds.maxValue, targetTickCount);

  canvas.strokeStyle = options.axisColor ?? DEFAULT_AXIS_COLOR;
  canvas.lineWidth = 1;
  canvas.beginPath();
  for (const tick of ticks) {
    const p = plotDataToPixel(bounds, rect, bounds.minT, tick);
    canvas.moveTo(rect.x, p.y);
    canvas.lineTo(rect.x + rect.width, p.y);
  }
  canvas.stroke();

  canvas.fillStyle = options.labelColor ?? DEFAULT_LABEL_COLOR;
  canvas.font = options.font ?? DEFAULT_FONT;
  canvas.textAlign = "left";
  canvas.textBaseline = "middle";
  for (const tick of ticks) {
    const p = plotDataToPixel(bounds, rect, bounds.minT, tick);
    canvas.fillText(formatTickValue(tick, step, series.unit), rect.x + 2, p.y);
  }

  if (series.t.length < 2) return;

  canvas.strokeStyle = options.curveColor ?? DEFAULT_CURVE_COLOR;
  canvas.lineWidth = 1.5;
  canvas.beginPath();
  for (let i = 0; i < series.t.length; i++) {
    const p = plotDataToPixel(bounds, rect, series.t[i]!, series.values[i]!);
    if (i === 0) canvas.moveTo(p.x, p.y);
    else canvas.lineTo(p.x, p.y);
  }
  canvas.stroke();
}
