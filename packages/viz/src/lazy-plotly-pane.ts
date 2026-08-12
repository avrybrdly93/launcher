/**
 * Lazy-loaded Plotly pane for the exploratory analysis panes (§6.2/ADR-007):
 * work-precision (log-log error vs cost) and phase plots (one channel
 * against another). The always-on panes stay on {@link ../plot-pane.js}'s
 * thin custom canvas plotter (P3.29, tiny and fast); these exploratory
 * panes want Plotly's zoom/export/hover richness instead, at the cost of a
 * multi-hundred-kB dependency -- acceptable only because {@link
 * loadPlotlyModule}'s `import()` keeps it out of the initial bundle
 * entirely, loaded on first open. This split (and the size trade its
 * gating relies on) is this task's validation criterion: Plotly must never
 * appear in the initial chunk.
 *
 * Figure construction ({@link buildWorkPrecisionFigure},
 * {@link buildPhasePlotFigure}, {@link buildPlotlyFigure}) is pure data
 * shaping with no dependency on the Plotly module itself, so it is fully
 * unit-testable without ever loading the library; only {@link
 * renderLazyPlotlyPane}/{@link disposeLazyPlotlyPane} touch the lazy import.
 */

import { plottableTracePoints, type NewtonTracePoint } from "@ballista/analysis";
import {
  sampleStabilityRegionGrid,
  type Complex,
  type Trajectory,
  type WorkPrecisionCurve,
} from "@ballista/solverkit";

/** One named (x, y) curve to plot -- a work-precision method's points, or a phase trajectory. */
export interface PlotlyScatterTrace {
  readonly kind?: "scatter";
  readonly name: string;
  readonly x: readonly number[];
  readonly y: readonly number[];
}

/**
 * A filled/leveled contour trace over a 2D grid (P3.43's `|R(z)|=1`
 * stability-region boundary): `z` is row-major `z[row][col]`, `row` indexing
 * `y` and `col` indexing `x`, matching {@link StabilityRegionGrid}'s shape
 * exactly so the grid never needs reshaping between solverkit and Plotly.
 */
export interface PlotlyContourTrace {
  readonly kind: "contour";
  readonly name: string;
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly (readonly number[])[];
  readonly contourStart: number;
  readonly contourEnd: number;
  readonly contourSize: number;
}

/** A trace is a plain scatter (the default, `kind` omitted, every pre-P3.43 builder's shape) or an explicit contour. */
export type PlotlyTrace = PlotlyScatterTrace | PlotlyContourTrace;

/** Axis label plus optional log scaling (work-precision plots are log-log; phase plots are linear). */
export interface PlotlyAxisSpec {
  readonly title: string;
  readonly type?: "linear" | "log";
}

/** Everything {@link buildPlotlyFigure} needs to produce a Plotly `data`/`layout` pair -- framework-agnostic, so it can be unit-tested and reused if the rendering library ever changes (§6.4's uPlot fallback note). */
export interface PlotlyFigureSpec {
  readonly title?: string;
  readonly traces: readonly PlotlyTrace[];
  readonly xAxis: PlotlyAxisSpec;
  readonly yAxis: PlotlyAxisSpec;
}

/** The narrow slice of Plotly's static API this pane calls -- see `plotly-js-dist-min.d.ts`. */
export interface PlotlyModule {
  newPlot(
    root: HTMLElement,
    data: readonly Record<string, unknown>[],
    layout?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ): Promise<unknown>;
  purge(root: HTMLElement): void;
}

let plotlyModulePromise: Promise<PlotlyModule> | undefined;

/**
 * Dynamically imports `plotly.js-dist-min`, memoized so repeated pane opens
 * within a session reuse the same module instance rather than re-fetching.
 * The `import()` expression is what makes Rollup/Vite split Plotly into its
 * own chunk -- true regardless of whether *this* module is itself statically
 * or dynamically imported elsewhere, since dynamic-import boundaries are a
 * property of the call site, not the caller's own import style.
 */
export function loadPlotlyModule(): Promise<PlotlyModule> {
  if (!plotlyModulePromise) {
    plotlyModulePromise = import("plotly.js-dist-min").then((mod) => mod.default);
  }
  return plotlyModulePromise;
}

/** Resets the memoized module promise -- test-only, so each test gets a fresh dynamic-import call. */
export function resetLazyPlotlyModuleForTesting(): void {
  plotlyModulePromise = undefined;
}

function traceToPlotly(trace: PlotlyTrace): Record<string, unknown> {
  if (trace.kind === "contour") {
    return {
      name: trace.name,
      x: trace.x,
      y: trace.y,
      z: trace.z,
      type: "contour",
      contours: {
        start: trace.contourStart,
        end: trace.contourEnd,
        size: trace.contourSize,
        coloring: "lines",
      },
      line: { width: 2 },
      showscale: false,
    };
  }
  return { name: trace.name, x: trace.x, y: trace.y, mode: "lines+markers", type: "scatter" };
}

/** Builds the Plotly `data`/`layout` pair for `spec`. Pure data shaping -- no Plotly import needed. */
export function buildPlotlyFigure(spec: PlotlyFigureSpec): {
  data: Record<string, unknown>[];
  layout: Record<string, unknown>;
} {
  return {
    data: spec.traces.map(traceToPlotly),
    layout: {
      ...(spec.title !== undefined ? { title: spec.title } : {}),
      xaxis: { title: spec.xAxis.title, type: spec.xAxis.type ?? "linear" },
      yaxis: { title: spec.yAxis.title, type: spec.yAxis.type ?? "linear" },
      margin: { t: spec.title !== undefined ? 32 : 8, r: 8, b: 40, l: 56 },
    },
  };
}

/**
 * Work-precision figure (§4 pedagogy: "same slope, offset intercepts" for
 * midpoint vs Heun; §3's Euler-needs-1e6-steps visceral point) from one or
 * more {@link WorkPrecisionCurve}s (`work-precision-harness.ts`, P2.19):
 * log-log error vs `nRHS` (cost), one trace per method.
 */
export function buildWorkPrecisionFigure(curves: readonly WorkPrecisionCurve[]): PlotlyFigureSpec {
  return {
    title: "Work-precision",
    traces: curves.map((curve) => ({
      name: curve.method,
      x: curve.points.map((p) => p.nRHS),
      y: curve.points.map((p) => p.error),
    })),
    xAxis: { title: "cost (rhs evaluations)", type: "log" },
    yAxis: { title: "global error", type: "log" },
  };
}

/** One method's (h, error) samples for a convergence-study figure -- shape-compatible with `measureConvergence`'s `ConvergenceResult` (`@ballista/solverkit`) plus a display label. */
export interface ConvergenceCurve {
  readonly method: string;
  readonly hs: readonly number[];
  readonly errors: readonly number[];
}

/**
 * Convergence-study figure (§4 pedagogy, P2.07/P3.42): log-log global error
 * vs step size `h`, one trace per method -- the slope of each trace is the
 * method's observed order of convergence, the same `measureConvergence`
 * (`convergence-harness.ts`) fits numerically; this only plots the same
 * `(h, error)` pairs that fit was computed from, so the visual slope and the
 * displayed numeric slope are never two different measurements.
 */
export function buildConvergenceFigure(curves: readonly ConvergenceCurve[]): PlotlyFigureSpec {
  return {
    title: "Convergence study",
    traces: curves.map((curve) => ({ name: curve.method, x: curve.hs, y: curve.errors })),
    xAxis: { title: "step size h (s)", type: "log" },
    yAxis: { title: "global error", type: "log" },
  };
}

/** One channel of a recorded {@link Trajectory}, identified by its column index and axis label/unit. */
export interface TrajectoryChannelSpec {
  readonly index: number;
  readonly label: string;
  readonly unit: string;
}

/**
 * Phase-plot figure (§6.2) plotting one recorded channel against another
 * (e.g. v_y vs y) straight off `trajectory.channels` -- no re-derived
 * physics, matching `plot-pane.ts`'s convention for verbatim channels.
 */
export function buildPhasePlotFigure(
  trajectory: Trajectory,
  xChannel: TrajectoryChannelSpec,
  yChannel: TrajectoryChannelSpec,
): PlotlyFigureSpec {
  return {
    title: `${yChannel.label} vs ${xChannel.label}`,
    traces: [
      {
        name: `${yChannel.label}(${xChannel.label})`,
        x: Array.from(trajectory.channels[xChannel.index]!),
        y: Array.from(trajectory.channels[yChannel.index]!),
      },
    ],
    xAxis: { title: `${xChannel.label} (${xChannel.unit})` },
    yAxis: { title: `${yChannel.label} (${yChannel.unit})` },
  };
}

/** Default resolution for {@link buildStabilityRegionFigure}'s sampled `|R(z)|` grid -- fine enough for a smooth-looking `|R(z)|=1` contour, coarse enough to compute well under a frame budget. */
const STABILITY_REGION_GRID_RESOLUTION = 121;

/**
 * Stability-region figure (§4.6, P3.43): the `|R(z)|=1` boundary for a
 * method of the given `order` (eq. 4.11's exact truncated-exponential
 * scope -- Euler/RK2/RK4), overlaid with the scenario's own `z = h*lambda`
 * points (already scaled by the caller's chosen `h`, `@ballista/runtime`'s
 * `sampleTrajectoryEigenvalues` returning raw `lambda`) so their migration
 * as the projectile decelerates is visible against the same axes as the
 * region boundary.
 */
export function buildStabilityRegionFigure(
  order: number,
  methodLabel: string,
  reRange: readonly [number, number],
  imRange: readonly [number, number],
  eigenvaluePoints: readonly Complex[],
): PlotlyFigureSpec {
  const grid = sampleStabilityRegionGrid(
    order,
    reRange,
    imRange,
    STABILITY_REGION_GRID_RESOLUTION,
    STABILITY_REGION_GRID_RESOLUTION,
  );

  return {
    title: `${methodLabel} stability region`,
    traces: [
      {
        kind: "contour",
        name: "|R(z)| = 1",
        x: grid.reAxis,
        y: grid.imAxis,
        z: grid.magnitude,
        contourStart: 1,
        contourEnd: 1,
        contourSize: 0,
      },
      {
        name: "h·λ (trajectory)",
        x: eigenvaluePoints.map((z) => z.re),
        y: eigenvaluePoints.map((z) => z.im),
      },
    ],
    xAxis: { title: "Re(z)" },
    yAxis: { title: "Im(z)" },
  };
}

/** One method's E(t)/E(0)-1 trace for {@link buildEnergyDriftFigure} -- shape-compatible with `runEnergyDriftStudy`'s (`@ballista/runtime`) `EnergyDriftMethodTrace` plus a display label. */
export interface EnergyDriftCurve {
  readonly method: string;
  readonly t: Float64Array;
  readonly relativeEnergyError: Float64Array;
}

/**
 * Energy-drift dashboard figure (§4.8 "flagship comparison exhibit", P3.44
 * shell / P4.12 full content): linear-linear `E(t)/E(0) - 1` vs `t`, one
 * trace per method, at whatever fixed-RHS-budget `h` each method's own
 * `runEnergyDriftStudy` trace was already run at -- this only plots the
 * same `(t, relativeEnergyError)` samples the study recorded, never
 * re-derives them.
 */
export function buildEnergyDriftFigure(curves: readonly EnergyDriftCurve[]): PlotlyFigureSpec {
  return {
    title: "Energy drift",
    traces: curves.map((curve) => ({
      name: curve.method,
      x: Array.from(curve.t),
      y: Array.from(curve.relativeEnergyError),
    })),
    xAxis: { title: "t (s)" },
    yAxis: { title: "E(t)/E(0) − 1" },
  };
}

/** One solve's residual history for {@link buildNewtonTraceFigure} -- {@link NewtonTracePoint}s (`@ballista/analysis`) plus a display label. */
export interface NewtonTraceCurve {
  readonly label: string;
  readonly points: readonly NewtonTracePoint[];
}

/**
 * Newton convergence-trace figure (P5.19): `‖F‖` on a log y-axis against a
 * *linear* iteration index, one trace per solve.
 *
 * **The mixed axes are the whole point, and are not an oversight.** The
 * neighbouring convergence and work-precision figures are log-log because
 * their x-axis is a continuous quantity (`h`, cost) whose power-law
 * relationship to the error shows up as a straight line. Here x is an
 * iteration *count*, and quadratic convergence is `log‖F‖` roughly doubling
 * per step — a curve that steepens, not a line. Putting iteration on a log
 * axis would flatten exactly the feature the plot exists to show.
 *
 * Points with a non-positive or non-finite `‖F‖` are dropped by
 * {@link plottableTracePoints}: a log axis has no place to put `‖F‖ = 0`, and
 * clamping would draw a residual the solve never reached.
 */
export function buildNewtonTraceFigure(curves: readonly NewtonTraceCurve[]): PlotlyFigureSpec {
  return {
    title: "Newton convergence",
    traces: curves.map((curve) => {
      const usable = plottableTracePoints(curve.points);
      return {
        name: curve.label,
        x: usable.map((point) => point.iteration),
        y: usable.map((point) => point.merit),
      };
    }),
    xAxis: { title: "Newton iteration k" },
    yAxis: { title: "‖F‖ (m)", type: "log" },
  };
}

/**
 * Mounts `spec` into `container` via lazy-loaded Plotly. Safe to call again
 * on the same `container` to update in place (Plotly's `newPlot` reconciles
 * an existing plot at the same root rather than requiring a separate
 * `react` call).
 */
export async function renderLazyPlotlyPane(
  container: HTMLElement,
  spec: PlotlyFigureSpec,
): Promise<void> {
  const plotly = await loadPlotlyModule();
  const { data, layout } = buildPlotlyFigure(spec);
  await plotly.newPlot(container, data, layout, { responsive: true, displaylogo: false });
}

/** Tears down a pane mounted via {@link renderLazyPlotlyPane}, releasing Plotly's internal listeners/DOM. */
export async function disposeLazyPlotlyPane(container: HTMLElement): Promise<void> {
  const plotly = await loadPlotlyModule();
  plotly.purge(container);
}
