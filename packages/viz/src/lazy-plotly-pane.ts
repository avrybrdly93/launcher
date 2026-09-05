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

import type { BasinOutcome, NewtonTracePoint } from "@ballista/analysis";
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

/**
 * A flat-shaded heatmap over a 2D grid (P5.20's basin map): `z` is row-major
 * `z[row][col]`, the same shape as {@link PlotlyContourTrace}, so both 2D
 * traces in this module agree with each other and with `StabilityRegionGrid`.
 *
 * **`z` is categorical, and the trace says so** — the values are class indices,
 * not a measured quantity. `colorScale` is therefore given as explicit
 * `[stop, colour]` pairs and `zMin`/`zMax` are pinned, because Plotly's default
 * autoscaled continuous scale would interpolate between two class indices and
 * draw a smooth gradient across a boundary that is a step. A cell either
 * converged to the low arc or it did not.
 */
export interface PlotlyHeatmapTrace {
  readonly kind: "heatmap";
  readonly name: string;
  readonly x: readonly number[];
  readonly y: readonly number[];
  readonly z: readonly (readonly (number | null)[])[];
  readonly zMin: number;
  readonly zMax: number;
  /** `[stop, css-colour]` pairs, stops in `[0, 1]`. */
  readonly colorScale: readonly (readonly [number, string])[];
}

/** A trace is a plain scatter (the default, `kind` omitted, every pre-P3.43 builder's shape), an explicit contour, or a heatmap. */
export type PlotlyTrace = PlotlyScatterTrace | PlotlyContourTrace | PlotlyHeatmapTrace;

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
  if (trace.kind === "heatmap") {
    return {
      name: trace.name,
      x: trace.x,
      y: trace.y,
      z: trace.z,
      type: "heatmap",
      colorscale: trace.colorScale.map(([stop, colour]) => [stop, colour]),
      zmin: trace.zMin,
      zmax: trace.zMax,
      // Flat cells, not a smoothed field: the quantity is a class index.
      zsmooth: false,
      showscale: false,
      hoverongaps: false,
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

/** The slice of `BasinGrid` (`@ballista/analysis`) {@link buildBasinFigure} draws -- structural, so a caller can hand it a whole grid. */
export interface BasinFigureGrid {
  readonly thetas: readonly number[];
  readonly speeds: readonly number[];
  readonly outcomes: readonly (readonly BasinOutcome[])[];
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
 * Points with a non-positive or non-finite `‖F‖` are dropped: a log axis has
 * no place to put `‖F‖ = 0`, and clamping would draw a residual the solve
 * never reached.
 *
 * **The predicate is inlined rather than imported from
 * `plottableTracePoints` (`@ballista/analysis`), which is the same rule.**
 * A value import there puts the whole analysis package into this module's
 * static graph, and `lazy-plotly-pane.bundle.test.ts` measured what that costs:
 * the initial chunk went from under 5 kB to 141 kB, because the point of this
 * module is that *nothing* heavy loads until the dynamic import fires. The
 * duplication is deliberate and pinned — a test asserts the two predicates
 * agree case for case, so they cannot drift apart silently.
 */
export function buildNewtonTraceFigure(curves: readonly NewtonTraceCurve[]): PlotlyFigureSpec {
  return {
    title: "Newton convergence",
    traces: curves.map((curve) => {
      const usable = curve.points.filter(
        (point) => Number.isFinite(point.merit) && point.merit > 0,
      );
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
 * Class index each basin outcome is drawn as. Exported so a legend and the
 * figure cannot disagree about which colour means which arc.
 *
 * `"failed"` maps to `null` rather than to a fourth index: Plotly renders a
 * null cell as a hole in the heatmap, which is the honest mark for "this
 * starting guess has no trajectory at all" — the grid strays outside the
 * reachable set there, and painting it a colour would suggest an outcome.
 */
export const BASIN_CLASS_INDEX: Readonly<Record<BasinOutcome, number | null>> = Object.freeze({
  low: 0,
  high: 1,
  unconverged: 2,
  failed: null,
});

/** Colour drawn for each class index of {@link buildBasinFigure}, in index order. */
export const BASIN_COLOURS: readonly string[] = Object.freeze([
  "#2d6a9f", // low arc — flat and fast
  "#c2571a", // high arc — lofted
  "#9aa0a6", // converged to no branch (on the peak, or short of tolerance)
]);

/**
 * Basin-of-attraction figure (P5.20): the starting-guess grid, each cell
 * painted by the arc `newtonShooting` converged to from there.
 *
 * **Axes are the *initial guess*, not the solution.** That is the entire point
 * of the picture: it answers "which arc will the solver give me if I start
 * here?", so both axes are quantities the caller chooses before solving.
 *
 * **The colour scale is built as flat bands rather than a gradient.** `z`
 * carries class indices, and a continuous scale would interpolate across a
 * boundary that is a step — drawing an arc that is neither low nor high in the
 * cells either side of the seam. Each class gets a closed band of the scale, so
 * every cell renders as exactly one of the three colours.
 *
 * **`BasinOutcome` is imported as a type only.** Same rule as
 * {@link buildNewtonTraceFigure}'s inlined predicate: a value import from
 * `@ballista/analysis` would pull the whole analysis package into this module's
 * static graph, and `lazy-plotly-pane.bundle.test.ts` exists because that costs
 * more than a hundred kB in the initial chunk. {@link BASIN_CLASS_INDEX} is
 * therefore declared here rather than imported.
 */
export function buildBasinFigure(grid: BasinFigureGrid): PlotlyFigureSpec {
  const classes = BASIN_COLOURS.length;
  // Closed bands: class i occupies [i/classes, (i+1)/classes] of the scale, so
  // no stop interpolates between two classes.
  const colorScale: [number, string][] = [];
  BASIN_COLOURS.forEach((colour, index) => {
    colorScale.push([index / classes, colour], [(index + 1) / classes, colour]);
  });

  return {
    title: "Newton basins of attraction",
    traces: [
      {
        kind: "heatmap",
        name: "converged arc",
        x: [...grid.thetas],
        y: [...grid.speeds],
        z: grid.outcomes.map((row) => row.map((outcome) => BASIN_CLASS_INDEX[outcome])),
        zMin: 0,
        // Half a band past the last index, matching the closed-band scale: the
        // colour axis spans exactly the three classes and nothing else.
        zMax: classes - 1,
        colorScale,
      },
    ],
    xAxis: { title: "initial θ₀ (rad)" },
    yAxis: { title: "initial v₀ (m/s)" },
  };
}

/** One row of the ill-conditioning exhibit -- the three fields {@link buildConditionNumberFigure} plots, which a caller maps from a `ConditioningSample` (`@ballista/analysis`) by picking an arc's `relativeConditionNumber`. Declared structurally rather than imported so this module keeps no dependency on the analysis package. */
export interface ConditionNumberPoint {
  /** Metres short of the envelope. Non-positive rows are dropped by the figure. */
  readonly envelopeMargin: number;
  /** The relative condition number at that margin. */
  readonly conditionNumber: number;
  /** `θ_high − θ_low` there, radians, or `null` if only one arc exists. */
  readonly arcSeparation: number | null;
}

/**
 * Ill-conditioning exhibit (P5.23): the relative condition number of the
 * fixed-speed aim problem against distance to the reachability envelope, with
 * the arc separation on the same axes.
 *
 * **Log-log, and the axes are the argument.** The claim this figure exists to
 * support is not "κ gets big near the envelope" but that it grows as
 * `margin^(-1/2)` — so the point of the picture is that the trace is a
 * *straight line of slope −1/2*, and only log-log makes that visible. On linear
 * axes the same data is a hyperbola-ish sweep up the left edge, which looks
 * dramatic and says nothing about the rate. This is the opposite choice from
 * {@link buildNewtonTraceFigure}, whose x-axis is an iteration count and
 * deliberately stays linear, and the same one as the work-precision and
 * convergence figures, whose x is continuous.
 *
 * **The fold is at the left-hand edge**, since the margin axis ascends
 * normally and the fold is where the margin is smallest. The alternative — a
 * reversed axis, so that approaching the envelope reads as moving rightward —
 * would need a `reversed` flag on {@link PlotlyAxisSpec} that nothing else
 * wants yet, and inventing shared vocabulary for one caller is how a figure
 * layer accretes options. Left as it is, deliberately.
 *
 * **Arc separation shares the plot rather than getting its own.** It falls as
 * `margin^(+1/2)`, so on these axes it is a line of the opposite slope, and the
 * two crossing traces are the fold's two faces — the Jacobian degenerating and
 * the two solutions merging — shown to be one phenomenon. Two separate figures
 * would show two coincidences.
 *
 * Rows at or beyond the envelope (`envelopeMargin ≤ 0`) are dropped rather than
 * clamped: they are past the fold, where there is no solution to be conditioned
 * and a log axis has nowhere to put them. Non-finite and non-positive κ go the
 * same way, for the reason {@link buildNewtonTraceFigure} states.
 */
export function buildConditionNumberFigure(
  points: readonly ConditionNumberPoint[],
): PlotlyFigureSpec {
  const usable = points.filter(
    (point) =>
      point.envelopeMargin > 0 &&
      Number.isFinite(point.envelopeMargin) &&
      point.conditionNumber > 0 &&
      Number.isFinite(point.conditionNumber),
  );
  const separated = usable.filter(
    (point) => point.arcSeparation !== null && point.arcSeparation > 0,
  );

  return {
    title: "Conditioning at the reachability envelope",
    traces: [
      {
        name: "κ (relative condition number)",
        x: usable.map((point) => point.envelopeMargin),
        y: usable.map((point) => point.conditionNumber),
      },
      {
        name: "arc separation θ₊ − θ₋ (rad)",
        x: separated.map((point) => point.envelopeMargin),
        y: separated.map((point) => point.arcSeparation!),
      },
    ],
    xAxis: { title: "margin to envelope (m), approaching the fold rightwards", type: "log" },
    yAxis: { title: "κ, and arc separation (rad)", type: "log" },
  };
}

/**
 * Per-container lifecycle bookkeeping for {@link renderLazyPlotlyPane} /
 * {@link disposeLazyPlotlyPane} (P0.118).
 *
 * WHY THIS EXISTS AT ALL. Both entry points are `async`, both are called
 * from a Preact effect that cannot await them, and before P0.118 neither
 * knew the other had run. That is a race with two losing orders, and the
 * one the route walk hits produces `Cannot read properties of undefined
 * (reading '_redrawFromAutoMarginCount')` — Plotly's own autoMargin redraw
 * counter, read off a graph div that has already been torn down:
 *
 *  - `newPlot` resolves *after* the route changed, so Plotly attaches
 *    listeners and schedules an autoMargin redraw against a container the
 *    router has already detached; or
 *  - `purge` runs *before* an in-flight `newPlot` finishes, so Plotly
 *    re-initialises internal state on a node that has just been retired.
 *
 * Neither is fixable from the component, because the component's cleanup is
 * synchronous and the work it is cleaning up is not. So the ordering is
 * owned here instead.
 */
interface PaneLifecycle {
  /**
   * Settles when every operation queued so far against this container has
   * finished, successfully or not. Chaining onto it is what guarantees a
   * `purge` never overlaps a `newPlot`.
   */
  queue: Promise<void>;
  /**
   * Bumped by every render *and* every dispose. An operation whose captured
   * token no longer matches has been superseded and must not touch the DOM
   * — which is how a render that was queued before an unmount declines to
   * mount anything at all, rather than mounting and being purged.
   */
  generation: number;
  /** Whether a `newPlot` has actually completed against this container. */
  plotted: boolean;
}

const paneLifecycles = new WeakMap<HTMLElement, PaneLifecycle>();

function lifecycleFor(container: HTMLElement): PaneLifecycle {
  const existing = paneLifecycles.get(container);
  if (existing) return existing;
  const created: PaneLifecycle = { queue: Promise.resolve(), generation: 0, plotted: false };
  paneLifecycles.set(container, created);
  return created;
}

/**
 * Chains `op` after everything already queued on this container, whether or
 * not that settled cleanly.
 *
 * The stored copy has its rejection swallowed deliberately. The queue is an
 * internal chaining promise that nobody awaits, so a rejection left on it
 * would surface as an *unhandled rejection* — the exact class of failure
 * P0.118's second manifestation is, and it would be perverse to introduce
 * one while fixing it. The promise handed back to the caller keeps its
 * rejection, so `renderLazyPlotlyPane`'s own failures stay observable.
 */
function enqueue(state: PaneLifecycle, op: () => Promise<void>): Promise<void> {
  const next = state.queue.then(op, op);
  state.queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

/**
 * Mounts `spec` into `container` via lazy-loaded Plotly. Safe to call again
 * on the same `container` to update in place (Plotly's `newPlot` reconciles
 * an existing plot at the same root rather than requiring a separate
 * `react` call), and safe to call concurrently with
 * {@link disposeLazyPlotlyPane}: the two are serialised per container.
 *
 * If a dispose (or a newer render) is requested before this one reaches
 * `newPlot`, this call resolves having done nothing. That is the point —
 * mounting into a container the caller has already given up on is what
 * P0.118 is.
 */
export async function renderLazyPlotlyPane(
  container: HTMLElement,
  spec: PlotlyFigureSpec,
): Promise<void> {
  const state = lifecycleFor(container);
  const generation = ++state.generation;
  return enqueue(state, async () => {
    const plotly = await loadPlotlyModule();
    if (state.generation !== generation) return;
    const { data, layout } = buildPlotlyFigure(spec);
    await plotly.newPlot(container, data, layout, { responsive: true, displaylogo: false });
    state.plotted = true;
  });
}

/**
 * Tears down a pane mounted via {@link renderLazyPlotlyPane}, releasing
 * Plotly's internal listeners/DOM.
 *
 * Two behaviours here are deliberate and are asserted by
 * `lazy-plotly-pane.runtime.test.ts`:
 *
 *  - **A container that was never rendered is a no-op**, and in particular
 *    does *not* load Plotly. The pre-P0.118 version called
 *    `loadPlotlyModule()` unconditionally, so unmounting a pane that had
 *    never opened would *initiate* the ~4.8 MB dynamic import purely in
 *    order to purge nothing — defeating the lazy boundary this module's
 *    whole doc comment is about, and widening the race window besides.
 *  - **The purge waits for any in-flight render**, rather than racing it.
 */
export async function disposeLazyPlotlyPane(container: HTMLElement): Promise<void> {
  const state = paneLifecycles.get(container);
  if (!state) return;
  ++state.generation;
  return enqueue(state, async () => {
    if (!state.plotted) return;
    // `plotted` implies `newPlot` resolved, which implies the module is
    // already loaded, so this await is a lookup and not an import.
    const plotly = await loadPlotlyModule();
    plotly.purge(container);
    state.plotted = false;
  });
}
