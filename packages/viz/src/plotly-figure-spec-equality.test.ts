/**
 * P0.124. These cases are about the two properties the module's comment calls
 * load-bearing, and they are written in pairs on purpose: for every field, one
 * case that two equal specs compare equal and one that a change to *that* field
 * alone is detected. A comparator is only useful if both halves hold -- one that
 * always returns `false` fixes nothing, and one that always returns `true`
 * leaves a stale plot on screen.
 *
 * The field-by-field half is not decoration: the comparison is hand-written, so
 * a field nobody compares is the failure mode, and `pnpm typecheck` only catches
 * a field nobody *destructures*. These are what catch a field destructured and
 * then left out of the returned expression.
 */
import { describe, expect, it } from "vitest";
import { plotlyFigureSpecsEqual } from "./plotly-figure-spec-equality.js";
import type {
  PlotlyContourTrace,
  PlotlyFigureSpec,
  PlotlyHeatmapTrace,
  PlotlyScatterTrace,
} from "./lazy-plotly-pane.js";

const SCATTER: PlotlyScatterTrace = { name: "a", x: [1, 2, 3], y: [4, 5, 6] };

const CONTOUR: PlotlyContourTrace = {
  kind: "contour",
  name: "c",
  x: [0, 1],
  y: [0, 1],
  z: [
    [0, 1],
    [2, 3],
  ],
  contourStart: 0,
  contourEnd: 1,
  contourSize: 0.5,
};

type ColorScale = PlotlyHeatmapTrace["colorScale"];

/**
 * Written out as typed constants rather than inline literals: in an argument
 * position TypeScript widens `[0, "#000"]` to `(number | string)[]` and the
 * tuple type is lost, which `pnpm typecheck` rejects. Naming them also makes
 * each "one stop moved" / "one colour changed" case read as the single change
 * it is.
 */
const SCALE: ColorScale = [
  [0, "#000"],
  [1, "#fff"],
];
const SCALE_STOP_MOVED: ColorScale = [
  [0, "#000"],
  [0.9, "#fff"],
];
const SCALE_COLOUR_CHANGED: ColorScale = [
  [0, "#000"],
  [1, "#eee"],
];
const SCALE_ONE_STOP: ColorScale = [[0, "#000"]];

const HEATMAP: PlotlyHeatmapTrace = {
  kind: "heatmap",
  name: "h",
  x: [0, 1],
  y: [0, 1],
  z: [
    [0, 1],
    [null, 2],
  ],
  zMin: 0,
  zMax: 2,
  colorScale: SCALE,
};

function figureOf(...traces: readonly PlotlyFigureSpec["traces"][number][]): PlotlyFigureSpec {
  return { title: "t", traces, xAxis: { title: "x" }, yAxis: { title: "y", type: "log" } };
}

/** Deep structural clone, so nothing in a "same" case can pass by identity. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("plotlyFigureSpecsEqual", () => {
  it("is true for the same object", () => {
    const spec = figureOf(SCATTER);
    expect(plotlyFigureSpecsEqual(spec, spec)).toBe(true);
  });

  it("is true for two structurally identical specs with no shared identity", () => {
    const spec = figureOf(SCATTER, CONTOUR, HEATMAP);
    const copy = clone(spec);
    // The premise of the whole fix: nothing here is reference-equal.
    expect(copy).not.toBe(spec);
    expect(copy.traces[0]).not.toBe(spec.traces[0]);
    expect(plotlyFigureSpecsEqual(spec, copy)).toBe(true);
  });

  describe("figure-level fields", () => {
    it("detects a changed title", () => {
      expect(plotlyFigureSpecsEqual(figureOf(SCATTER), { ...figureOf(SCATTER), title: "u" })).toBe(
        false,
      );
    });

    it("detects a title that appears and disappears", () => {
      const withTitle = figureOf(SCATTER);
      const { title: _dropped, ...withoutTitle } = withTitle;
      expect(plotlyFigureSpecsEqual(withTitle, withoutTitle)).toBe(false);
      expect(plotlyFigureSpecsEqual(withoutTitle, withTitle)).toBe(false);
    });

    it("detects a changed axis title on either axis", () => {
      const base = figureOf(SCATTER);
      expect(plotlyFigureSpecsEqual(base, { ...base, xAxis: { title: "s" } })).toBe(false);
      expect(plotlyFigureSpecsEqual(base, { ...base, yAxis: { title: "s", type: "log" } })).toBe(
        false,
      );
    });

    it("detects an axis switching between linear and log", () => {
      const base = figureOf(SCATTER);
      expect(plotlyFigureSpecsEqual(base, { ...base, yAxis: { title: "y" } })).toBe(false);
      expect(plotlyFigureSpecsEqual(base, { ...base, yAxis: { title: "y", type: "linear" } })).toBe(
        false,
      );
    });

    it("detects a trace added or removed", () => {
      expect(plotlyFigureSpecsEqual(figureOf(SCATTER), figureOf(SCATTER, CONTOUR))).toBe(false);
      expect(plotlyFigureSpecsEqual(figureOf(SCATTER, CONTOUR), figureOf(SCATTER))).toBe(false);
    });

    it("treats trace order as significant, because Plotly colours by index", () => {
      expect(plotlyFigureSpecsEqual(figureOf(CONTOUR, HEATMAP), figureOf(HEATMAP, CONTOUR))).toBe(
        false,
      );
    });

    it("detects a trace kind changing under an otherwise identical shape", () => {
      // Same name, same x, same y -- only `kind` differs, and the two draw
      // completely different pictures.
      const asScatter = figureOf({ name: "c", x: [0, 1], y: [0, 1] });
      const asContour = figureOf({ ...CONTOUR, name: "c" });
      expect(plotlyFigureSpecsEqual(asScatter, asContour)).toBe(false);
    });
  });

  describe("scatter traces", () => {
    it('treats an absent kind and an explicit "scatter" as the same trace kind', () => {
      // Two builders that draw the same line must not remount each other, and
      // every pre-P3.43 builder omits `kind`.
      expect(
        plotlyFigureSpecsEqual(figureOf(SCATTER), figureOf({ ...SCATTER, kind: "scatter" })),
      ).toBe(true);
    });

    it("detects a changed name, x value, y value, or series length", () => {
      const base = figureOf(SCATTER);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...SCATTER, name: "b" }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...SCATTER, x: [1, 2, 4] }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...SCATTER, y: [4, 5, 7] }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...SCATTER, x: [1, 2] }))).toBe(false);
    });

    it("treats NaN as equal to NaN, so a gap in a line is not a change", () => {
      // `===` would report every figure holding a gap as changed on every
      // render -- the exact defect P0.124 is about, surviving the fix.
      const gapped = figureOf({ ...SCATTER, y: [4, Number.NaN, 6] });
      expect(plotlyFigureSpecsEqual(gapped, figureOf({ ...SCATTER, y: [4, Number.NaN, 6] }))).toBe(
        true,
      );
      // And `clone` is NOT a valid "same" case for this one, which is worth
      // asserting rather than quietly avoiding: JSON round-tripping turns NaN
      // into null, so the copy really is a different figure and `false` is the
      // right answer. Every other "same" case above relies on `clone`, so the
      // one place it is not structure-preserving is named here.
      expect(plotlyFigureSpecsEqual(gapped, clone(gapped))).toBe(false);
    });
  });

  describe("contour traces", () => {
    it("detects a changed z cell, a reshaped z, and each contour level", () => {
      const base = figureOf(CONTOUR);
      expect(
        plotlyFigureSpecsEqual(
          base,
          figureOf({
            ...CONTOUR,
            z: [
              [0, 1],
              [2, 4],
            ],
          }),
        ),
      ).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...CONTOUR, z: [[0, 1]] }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...CONTOUR, contourStart: 0.1 }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...CONTOUR, contourEnd: 1.1 }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...CONTOUR, contourSize: 0.25 }))).toBe(false);
    });

    it("detects a z row of a different width", () => {
      expect(
        plotlyFigureSpecsEqual(
          figureOf(CONTOUR),
          figureOf({
            ...CONTOUR,
            z: [
              [0, 1],
              [2, 3, 4],
            ],
          }),
        ),
      ).toBe(false);
    });
  });

  describe("heatmap traces", () => {
    it("detects each of zMin, zMax and a changed colour stop or colour", () => {
      const base = figureOf(HEATMAP);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...HEATMAP, zMin: -1 }))).toBe(false);
      expect(plotlyFigureSpecsEqual(base, figureOf({ ...HEATMAP, zMax: 3 }))).toBe(false);
      expect(
        plotlyFigureSpecsEqual(base, figureOf({ ...HEATMAP, colorScale: SCALE_STOP_MOVED })),
      ).toBe(false);
      expect(
        plotlyFigureSpecsEqual(base, figureOf({ ...HEATMAP, colorScale: SCALE_COLOUR_CHANGED })),
      ).toBe(false);
      expect(
        plotlyFigureSpecsEqual(base, figureOf({ ...HEATMAP, colorScale: SCALE_ONE_STOP })),
      ).toBe(false);
    });

    it("distinguishes a null cell from a numeric one, in both directions", () => {
      // The basin map's `null` means "no class here". A comparison that
      // coerced it to 0 would paint an unconverged cell as the low arc.
      const base = figureOf(HEATMAP);
      expect(
        plotlyFigureSpecsEqual(
          base,
          figureOf({
            ...HEATMAP,
            z: [
              [0, 1],
              [0, 2],
            ],
          }),
        ),
      ).toBe(false);
      expect(
        plotlyFigureSpecsEqual(
          figureOf({
            ...HEATMAP,
            z: [
              [0, 1],
              [0, 2],
            ],
          }),
          base,
        ),
      ).toBe(false);
    });
  });
});
