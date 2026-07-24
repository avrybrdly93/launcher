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

import type { Trajectory, WorkPrecisionCurve } from "@ballista/solverkit";

/** One named (x, y) curve to plot -- a work-precision method's points, or a phase trajectory. */
export interface PlotlyTrace {
  readonly name: string;
  readonly x: readonly number[];
  readonly y: readonly number[];
}

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
