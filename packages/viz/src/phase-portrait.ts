/**
 * Phase-portrait pane (§6.2's analysis-plot family, P4.32): one recorded
 * solve drawn as a (q, p) curve instead of a value-vs-time trace, which is
 * the view that makes an integrator's structure preservation visible
 * directly -- an explicit Euler orbit spirals outward while a symplectic
 * Verlet orbit stays closed, on the same model, same h, same span.
 *
 * Two concerns, split the same way {@link ./plot-pane.js} splits them: pure
 * series derivation from a solve's own recorder output (no re-derived
 * physics -- both axes are recorder channels verbatim, selected via
 * `model.partitions`, so there is nothing to re-derive), and a thin
 * rendering pass. The screen mapping and axis ticks are `plot-pane.ts`'s
 * own `plotScreenX`/`plotScreenY`/tick helpers reused as-is rather than
 * re-implemented: a phase portrait is the same linear-scale pane geometry
 * with a state channel on the horizontal axis in place of `t`.
 *
 * {@link cycleAreas} is the quantitative half -- the enclosed phase-space
 * area per revolution, which is what "Euler spiral vs Verlet closed orbit"
 * means as an automated assertion (P4.32's validation criterion) rather
 * than an eyeball check of a picture.
 */

import type { Model } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import { computeAxisTicks, computeNiceStep, formatTickValue } from "./axes-layer.js";
import {
  type PlotPaneLayout,
  type PlotPaneRange,
  type PlotScreenPoint,
  plotScreenX,
  plotScreenY,
} from "./plot-pane.js";

/**
 * One (q, p) curve: parallel channel arrays plus each axis's own label and
 * unit, read off `model.channels` so the pane never invents its own names
 * for channels the model already names.
 */
export interface PhasePortraitSeries {
  readonly qLabel: string;
  readonly qUnit: string;
  readonly pLabel: string;
  readonly pUnit: string;
  readonly q: Float64Array;
  readonly p: Float64Array;
}

/** The `model.partitions` channel indices one phase portrait plots against each other. */
export interface PhasePairIndices {
  readonly qIndex: number;
  readonly pIndex: number;
}

/**
 * Which `model.partitions` pair {@link phasePortraitSeries} plots by
 * default. `partitions.q[i]`/`partitions.p[i]` are paired by index (see
 * `planar-projectile-model.ts`'s own note on the convention), so a model
 * with k pairs offers k phase portraits and the pane has to pick one.
 *
 * Pair 1 for any model with two or more pairs, pair 0 otherwise. That is
 * exactly P4.32's stated framing ("y vs v_y; q vs p for pendulum") and not
 * a coincidence of index arithmetic: `PLANAR_CHANNELS` and
 * `SPATIAL_CHANNELS` both order positions `x, y, ...` with `y` the
 * gravity-aligned one, so pair 1 is (y, v_y) under both conventions, while
 * the dim-2 pendulum has a single pair and falls through to pair 0
 * (theta, thetadot).
 */
export function defaultPhasePairIndex(model: Model): number {
  const pairs = model.partitions?.q.length ?? 0;
  return pairs >= 2 ? 1 : 0;
}

/**
 * Resolves `pairIndex` against `model.partitions`. Throws for a model with
 * no `partitions` at all (nothing declares which channels are conjugate, so
 * there is no phase portrait to draw -- the same "descriptive throw over a
 * silent wrong answer" choice `scenario-resolver.ts` makes for an unknown
 * model kind) and for an out-of-range pair.
 */
export function phasePairIndices(
  model: Model,
  pairIndex: number = defaultPhasePairIndex(model),
): PhasePairIndices {
  const partitions = model.partitions;
  if (!partitions) {
    throw new Error("phasePairIndices: model declares no partitions (q/p) to plot");
  }
  const qIndex = partitions.q[pairIndex];
  const pIndex = partitions.p[pairIndex];
  if (qIndex === undefined || pIndex === undefined) {
    throw new Error(
      `phasePairIndices: pair ${pairIndex} out of range (model has ${partitions.q.length} q/p pair(s))`,
    );
  }
  return { qIndex, pIndex };
}

/**
 * The (q, p) curve of `trajectory` under `model`'s partition convention --
 * both axes read straight off `trajectory.channels`, no derivation, so the
 * curve is the recorded state and nothing else.
 */
export function phasePortraitSeries(
  model: Model,
  trajectory: Trajectory,
  pairIndex: number = defaultPhasePairIndex(model),
): PhasePortraitSeries {
  const { qIndex, pIndex } = phasePairIndices(model, pairIndex);
  const qMeta = model.channels[qIndex];
  const pMeta = model.channels[pIndex];
  return {
    qLabel: qMeta?.name ?? `y[${qIndex}]`,
    qUnit: qMeta?.unit ?? "",
    pLabel: pMeta?.name ?? `y[${pIndex}]`,
    pUnit: pMeta?.unit ?? "",
    q: trajectory.channels[qIndex]!,
    p: trajectory.channels[pIndex]!,
  };
}

/**
 * Signed area enclosed by the closed polygon through `(q[i], p[i])`, by the
 * shoelace formula, treating the last point as joined back to the first.
 * Positive for a counter-clockwise traversal; orbits swept clockwise (the
 * usual sense for a (position, velocity) pendulum portrait) come out
 * negative, which is why {@link cycleAreas} reports magnitudes.
 *
 * Fewer than 3 points enclose nothing and give exactly 0.
 */
export function signedPolygonArea(q: Float64Array, p: Float64Array): number {
  const n = Math.min(q.length, p.length);
  if (n < 3) return 0;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    const j = i + 1 === n ? 0 : i + 1;
    sum += q[i]! * p[j]! - q[j]! * p[i]!;
  }
  return 0.5 * sum;
}

/**
 * Per-axis scale used to make the revolution counter in {@link cycleAreas}
 * scale-invariant: a pendulum portrait in (rad, rad/s) is an ellipse whose
 * two axes differ by roughly the natural frequency, and the polar angle
 * about the origin advances very non-uniformly around such an ellipse. The
 * angle is therefore measured in coordinates normalized by each axis's own
 * peak magnitude, which turns the ellipse back into something close to a
 * circle. Areas themselves are always computed in the raw, unnormalized
 * units -- normalization exists only to decide *where* one revolution ends.
 */
function peakMagnitude(values: Float64Array, n: number): number {
  let peak = 0;
  for (let i = 0; i < n; i++) {
    const magnitude = Math.abs(values[i]!);
    if (magnitude > peak) peak = magnitude;
  }
  return peak > 0 ? peak : 1;
}

/**
 * Enclosed phase-space area, one entry per complete revolution the orbit
 * makes about the origin, in the series' own (q-unit x p-unit) units.
 *
 * Revolutions are cut where the cumulative polar angle about the origin
 * (measured in the normalized coordinates described above, and unwrapped
 * step to step so a branch cut never registers as a lap) passes each
 * successive multiple of 2*pi. Each revolution's slice is then closed back
 * to its own first point and measured with {@link signedPolygonArea}, so a
 * closed orbit yields the same area every lap while a spiral yields a
 * growing one. A partial final revolution is discarded rather than reported
 * as a short lap.
 *
 * This is the automated form of P4.32's validation criterion: for the same
 * conservative model, span, and h, `ExplicitEulerStepper` produces a
 * strictly growing sequence here and the symplectic `VerletStepper`
 * produces a flat one.
 */
export function cycleAreas(series: PhasePortraitSeries): number[] {
  const n = Math.min(series.q.length, series.p.length);
  if (n < 3) return [];

  const qScale = peakMagnitude(series.q, n);
  const pScale = peakMagnitude(series.p, n);

  const areas: number[] = [];
  let cycleStart = 0;
  let cumulativeAngle = 0;
  let previousAngle = Math.atan2(series.p[0]! / pScale, series.q[0]! / qScale);

  for (let i = 1; i < n; i++) {
    const angle = Math.atan2(series.p[i]! / pScale, series.q[i]! / qScale);
    let delta = angle - previousAngle;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    else if (delta < -Math.PI) delta += 2 * Math.PI;
    cumulativeAngle += delta;
    previousAngle = angle;

    if (Math.abs(cumulativeAngle) >= 2 * Math.PI) {
      const length = i - cycleStart + 1;
      areas.push(
        Math.abs(
          signedPolygonArea(
            series.q.subarray(cycleStart, cycleStart + length),
            series.p.subarray(cycleStart, cycleStart + length),
          ),
        ),
      );
      cycleStart = i;
      cumulativeAngle = 0;
    }
  }

  return areas;
}

/**
 * `cycleAreas`' last entry over its first -- 1 for an orbit that closes on
 * itself, > 1 for one that spirals outward, < 1 for one that spirals in.
 * Returns 1 for a run with fewer than two complete revolutions (nothing to
 * compare) or a degenerate zero-area first lap.
 */
export function areaGrowthRatio(series: PhasePortraitSeries): number {
  const areas = cycleAreas(series);
  if (areas.length < 2) return 1;
  const first = areas[0]!;
  return first === 0 ? 1 : areas[areas.length - 1]! / first;
}

/** `series.q`'s span, padded when the axis is degenerate, matching `plot-pane.ts`'s `computeSeriesValueRange` behavior on a flat series. */
export function computePhaseAxisRange(values: Float64Array): PlotPaneRange {
  const n = values.length;
  if (n === 0) return { min: 0, max: 1 };

  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = values[i]!;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  if (max > min) return { min, max };

  const pad = min !== 0 ? Math.abs(min) * 0.05 : 1;
  return { min: min - pad, max: max + pad };
}

/**
 * `series`, one point at a time, mapped into `layout`'s screen rectangle.
 * Reuses `plot-pane.ts`'s `plotScreenX`/`plotScreenY` unchanged -- q takes
 * the horizontal axis in place of t, p the vertical in place of the plotted
 * value -- so the same "no resampling, no smoothing, one screen point per
 * recorded row" guarantee (and the same exact inverses) carries over.
 */
export function buildPhaseScreenPoints(
  series: PhasePortraitSeries,
  layout: PlotPaneLayout,
  qRange: PlotPaneRange = computePhaseAxisRange(series.q),
  pRange: PlotPaneRange = computePhaseAxisRange(series.p),
): PlotScreenPoint[] {
  const n = Math.min(series.q.length, series.p.length);
  const points: PlotScreenPoint[] = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = {
      x: plotScreenX(series.q[i]!, qRange, layout),
      y: plotScreenY(series.p[i]!, pRange, layout),
    };
  }
  return points;
}

/** The subset of `CanvasRenderingContext2D` {@link drawPhasePortrait} needs -- identical to `plot-pane.ts`'s, re-declared rather than widened so neither pane constrains the other. */
export interface PhasePortraitCanvas {
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

export interface PhasePortraitOptions {
  readonly color?: string;
  readonly lineWidth?: number;
  readonly targetTickCount?: number;
  readonly font?: string;
  readonly labelColor?: string;
}

const DEFAULT_PHASE_COLOR = "#1c7ed6";
const DEFAULT_PHASE_LINE_WIDTH = 1.5;
const DEFAULT_LABEL_COLOR = "rgba(64, 64, 64, 0.9)";
const DEFAULT_FONT = "11px sans-serif";
const DEFAULT_TARGET_TICK_COUNT = 4;

/**
 * Draws `series` as a polyline filling `layout`, plus p-axis ticks (left
 * edge) and q-axis ticks (bottom edge), each labeled in that axis's own
 * unit via `axes-layer.ts`'s `formatTickValue`, and a corner label naming
 * the pair (e.g. `theta-thetadot`). Unlike `drawPlotPane` the horizontal
 * axis is a state channel, so its ticks are labeled with `series.qUnit`
 * rather than seconds. A degenerate axis draws the curve but skips that
 * axis's ticks, matching `computeAxisTicks`'s own `span > 0` requirement.
 */
export function drawPhasePortrait(
  canvas: PhasePortraitCanvas,
  series: PhasePortraitSeries,
  layout: PlotPaneLayout,
  options: PhasePortraitOptions = {},
): void {
  const targetTickCount = options.targetTickCount ?? DEFAULT_TARGET_TICK_COUNT;
  const qRange = computePhaseAxisRange(series.q);
  const pRange = computePhaseAxisRange(series.p);
  const points = buildPhaseScreenPoints(series, layout, qRange, pRange);

  canvas.strokeStyle = options.color ?? DEFAULT_PHASE_COLOR;
  canvas.lineWidth = options.lineWidth ?? DEFAULT_PHASE_LINE_WIDTH;
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

  if (pRange.max > pRange.min) {
    const step = computeNiceStep(pRange.min, pRange.max, targetTickCount);
    canvas.textAlign = "left";
    canvas.textBaseline = "middle";
    for (const tick of computeAxisTicks(pRange.min, pRange.max, targetTickCount)) {
      canvas.fillText(
        formatTickValue(tick, step, series.pUnit),
        layout.x,
        plotScreenY(tick, pRange, layout),
      );
    }
  }

  if (qRange.max > qRange.min) {
    const step = computeNiceStep(qRange.min, qRange.max, targetTickCount);
    canvas.textAlign = "center";
    canvas.textBaseline = "top";
    for (const tick of computeAxisTicks(qRange.min, qRange.max, targetTickCount)) {
      canvas.fillText(
        formatTickValue(tick, step, series.qUnit),
        plotScreenX(tick, qRange, layout),
        layout.y + layout.height + 2,
      );
    }
  }

  canvas.textAlign = "right";
  canvas.textBaseline = "top";
  canvas.fillText(`${series.qLabel}-${series.pLabel}`, layout.x + layout.width, layout.y);
}
