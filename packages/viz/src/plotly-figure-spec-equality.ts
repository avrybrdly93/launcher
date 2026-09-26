/**
 * Structural equality for {@link PlotlyFigureSpec} (P0.124).
 *
 * **Why this exists.** `LazyPlotlyView`'s `useLayoutEffect` keyed on `[spec]`
 * meant a fresh spec object -- which every one of the five call sites produced
 * on every render -- tore the Plotly pane down and mounted it again whether or
 * not the figure had changed. Memoising at each call site would have fixed the
 * five that exist and not the sixth; comparing here fixes all of them, and the
 * spec is the right place to own the question of when two figures are the same
 * figure.
 *
 * **Why a hand-written comparison rather than a deep-equal helper.**
 * `PlotlyFigureSpec` is a closed, fully serialisable shape: strings, numbers,
 * optional string unions, arrays of numbers, row-major arrays of arrays, and
 * `[number, string]` tuples. There are no functions, dates, maps or class
 * instances anywhere in it, so a comparison written against the declared fields
 * is *total* rather than a guess about arbitrary JavaScript values.
 *
 * **Two properties make this safe to key a lifecycle on, and both are load-bearing:**
 *
 * 1. **It is fail-safe toward remounting.** Every branch that cannot fully
 *    traverse and match reports `false`. A false `false` costs one remount --
 *    exactly the behaviour that existed before this module -- while a false
 *    `true` would leave a stale plot on screen, which is a correctness bug. The
 *    asymmetry is deliberate and any future edit must preserve it.
 * 2. **Adding a field to the spec breaks the build, not the picture.** Each
 *    comparison destructures the fields it compares and hands the rest to
 *    {@link assertEveryFieldCompared}, whose parameter type only accepts an
 *    empty object. A field added to any of these interfaces therefore fails
 *    `pnpm typecheck` -- which is in the push gate -- instead of silently
 *    making two different figures compare equal.
 */

import type {
  PlotlyAxisSpec,
  PlotlyContourTrace,
  PlotlyFigureSpec,
  PlotlyHeatmapTrace,
  PlotlyScatterTrace,
  PlotlyTrace,
} from "./lazy-plotly-pane.js";

/**
 * Compile-time exhaustiveness guard. Callers destructure every field they
 * compare and pass the rest element here; `Record<string, never>` accepts only
 * an empty object, so a field nobody compared is a type error at the call site.
 * A no-op at runtime, deliberately -- the whole value is in the type.
 */
function assertEveryFieldCompared(_uncompared: Record<string, never>): void {
  // Intentionally empty. See the module comment, property 2.
}

/**
 * `Object.is` rather than `===` so `NaN` equals `NaN`. That matters here: a
 * `NaN` in a trace is how a line says "gap", and `===` would report every
 * figure containing one as changed on every render, which is the defect this
 * module exists to remove. The other difference `Object.is` makes -- `+0` and
 * `-0` comparing unequal -- errs toward a remount, which is the safe direction.
 */
function sameNumber(a: number | null, b: number | null): boolean {
  return Object.is(a, b);
}

function numberListsEqual(a: readonly number[], b: readonly number[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!sameNumber(a[index]!, b[index]!)) return false;
  }
  return true;
}

/** Row-major `z[row][col]`, the shape both 2D traces use. */
function numberGridsEqual(
  a: readonly (readonly (number | null)[])[],
  b: readonly (readonly (number | null)[])[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let row = 0; row < a.length; row += 1) {
    const left = a[row]!;
    const right = b[row]!;
    if (left === right) continue;
    if (left.length !== right.length) return false;
    for (let col = 0; col < left.length; col += 1) {
      if (!sameNumber(left[col]!, right[col]!)) return false;
    }
  }
  return true;
}

function colorScalesEqual(
  a: readonly (readonly [number, string])[],
  b: readonly (readonly [number, string])[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    const [aStop, aColour] = a[index]!;
    const [bStop, bColour] = b[index]!;
    if (!sameNumber(aStop, bStop) || aColour !== bColour) return false;
  }
  return true;
}

function axesEqual(a: PlotlyAxisSpec, b: PlotlyAxisSpec): boolean {
  const { title, type, ...uncompared } = a;
  assertEveryFieldCompared(uncompared);
  return title === b.title && type === b.type;
}

/**
 * A scatter trace's `kind` is optional, so `undefined` and `"scatter"` are the
 * same trace kind and are normalised to one value here. Two figures that render
 * identically must compare equal; treating the absent discriminant as a
 * difference would reintroduce the remount for every pre-P3.43 builder.
 */
function traceKind(trace: PlotlyTrace): "scatter" | "contour" | "heatmap" {
  return trace.kind ?? "scatter";
}

function scatterTracesEqual(a: PlotlyScatterTrace, b: PlotlyScatterTrace): boolean {
  const { kind: _kind, name, x, y, ...uncompared } = a;
  assertEveryFieldCompared(uncompared);
  return name === b.name && numberListsEqual(x, b.x) && numberListsEqual(y, b.y);
}

function contourTracesEqual(a: PlotlyContourTrace, b: PlotlyContourTrace): boolean {
  const { kind: _kind, name, x, y, z, contourStart, contourEnd, contourSize, ...uncompared } = a;
  assertEveryFieldCompared(uncompared);
  return (
    name === b.name &&
    numberListsEqual(x, b.x) &&
    numberListsEqual(y, b.y) &&
    numberGridsEqual(z, b.z) &&
    sameNumber(contourStart, b.contourStart) &&
    sameNumber(contourEnd, b.contourEnd) &&
    sameNumber(contourSize, b.contourSize)
  );
}

function heatmapTracesEqual(a: PlotlyHeatmapTrace, b: PlotlyHeatmapTrace): boolean {
  const { kind: _kind, name, x, y, z, zMin, zMax, colorScale, ...uncompared } = a;
  assertEveryFieldCompared(uncompared);
  return (
    name === b.name &&
    numberListsEqual(x, b.x) &&
    numberListsEqual(y, b.y) &&
    numberGridsEqual(z, b.z) &&
    sameNumber(zMin, b.zMin) &&
    sameNumber(zMax, b.zMax) &&
    colorScalesEqual(colorScale, b.colorScale)
  );
}

function tracesEqual(a: PlotlyTrace, b: PlotlyTrace): boolean {
  if (a === b) return true;
  const kind = traceKind(a);
  if (kind !== traceKind(b)) return false;
  switch (kind) {
    case "scatter":
      return scatterTracesEqual(a as PlotlyScatterTrace, b as PlotlyScatterTrace);
    case "contour":
      return contourTracesEqual(a as PlotlyContourTrace, b as PlotlyContourTrace);
    case "heatmap":
      return heatmapTracesEqual(a as PlotlyHeatmapTrace, b as PlotlyHeatmapTrace);
    default:
      // Unreachable while PlotlyTrace holds the three kinds above, and `false`
      // rather than a throw if it ever is: property 1 of the module comment
      // says an unrecognised shape remounts.
      return false;
  }
}

function traceListsEqual(a: readonly PlotlyTrace[], b: readonly PlotlyTrace[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (!tracesEqual(a[index]!, b[index]!)) return false;
  }
  return true;
}

/**
 * True when `a` and `b` describe the same figure -- the same title, the same
 * axes, and the same traces in the same order, compared by value.
 *
 * Trace *order* is significant, deliberately: Plotly draws traces in order and
 * assigns them colours from a palette by index, so two specs holding the same
 * traces in a different order are two different pictures.
 */
export function plotlyFigureSpecsEqual(a: PlotlyFigureSpec, b: PlotlyFigureSpec): boolean {
  if (a === b) return true;
  const { title, traces, xAxis, yAxis, ...uncompared } = a;
  assertEveryFieldCompared(uncompared);
  return (
    title === b.title &&
    axesEqual(xAxis, b.xAxis) &&
    axesEqual(yAxis, b.yAxis) &&
    traceListsEqual(traces, b.traces)
  );
}
