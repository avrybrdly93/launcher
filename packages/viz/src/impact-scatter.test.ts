import { describe, expect, it } from "vitest";
import type { Camera2DState, Viewport } from "./camera2d.js";
import { worldToScreen } from "./camera2d.js";
import {
  DEFAULT_IMPACT_CELL_PX,
  buildImpactHistogram,
  buildImpactScatter,
} from "./impact-scatter.js";

const CAMERA: Camera2DState = { centerX: 0, centerY: 0, scaleX: 1, scaleY: 1 };
const VIEWPORT: Viewport = { width: 1200, height: 800 };

/**
 * Deterministic LCG. `Math.random` would make a failure unreproducible, and
 * every seeded generator in this repo is seeded for that reason (P6.03).
 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

describe("buildImpactHistogram (P6.09: the planar model's x_impact distribution)", () => {
  it("bins a known uniform sample into exactly equal bins", () => {
    // 1000 values evenly spaced over [0, 1) into 10 bins is 100 apiece, with
    // no appeal to approximate equality: the analytic answer is an integer.
    const values = Float64Array.from({ length: 1000 }, (_, i) => i / 1000);
    const h = buildImpactHistogram(values, { binCount: 10, domain: [0, 1] });

    expect(Array.from(h.counts)).toEqual([100, 100, 100, 100, 100, 100, 100, 100, 100, 100]);
    expect(h.total).toBe(1000);
    expect(h.belowDomain).toBe(0);
    expect(h.aboveDomain).toBe(0);
    expect(h.excluded).toBe(0);
  });

  it("puts the largest value in the last bin rather than losing it off the end", () => {
    // The off-by-one this guards is silent: with a half-open last bin the
    // single most extreme replicate -- the one a reader of a dispersion chart
    // most wants to see -- vanishes from every histogram.
    const h = buildImpactHistogram([0, 1, 2, 3, 4], { binCount: 5 });

    expect(Array.from(h.counts)).toEqual([1, 1, 1, 1, 1]);
    expect(h.total).toBe(5);
    expect(h.aboveDomain).toBe(0);
    expect(h.binEdges[5]).toBe(4);
  });

  it("emits ascending edges of the requested length, pinned exactly to the domain", () => {
    const h = buildImpactHistogram([0.1, 0.7], { binCount: 7, domain: [-3, 11] });

    expect(h.binEdges).toHaveLength(8);
    expect(h.binEdges[0]).toBe(-3);
    expect(h.binEdges[7]).toBe(11);
    for (let b = 1; b < h.binEdges.length; b++) {
      expect(h.binEdges[b]!).toBeGreaterThan(h.binEdges[b - 1]!);
    }
  });

  it("reports values outside an explicit domain instead of clamping them into the end bins", () => {
    // Clamping would invent two spikes at the axis limits that no replicate
    // produced; the counts have to stay a count of what is actually in view.
    const h = buildImpactHistogram([-1, 0.5, 2], { binCount: 4, domain: [0, 1] });

    expect(h.total).toBe(1);
    expect(h.belowDomain).toBe(1);
    expect(h.aboveDomain).toBe(1);
    expect(Array.from(h.counts)).toEqual([0, 0, 1, 0]);
  });

  it("excludes replicates the mask rejects, and the tail beyond a short mask", () => {
    const values = [10, 20, 30, 40];
    const masked = buildImpactHistogram(values, { binCount: 2, mask: Uint8Array.of(1, 0, 1, 0) });
    expect(masked.total).toBe(2);
    expect(masked.excluded).toBe(2);

    // A mask shorter than the column is a wiring bug, and admitting the tail
    // would let un-landed replicates through exactly when the guard is
    // already wrong.
    const short = buildImpactHistogram(values, { binCount: 2, mask: Uint8Array.of(1, 1) });
    expect(short.total).toBe(2);
    expect(short.excluded).toBe(2);
  });

  it("excludes non-finite values rather than binning them", () => {
    const h = buildImpactHistogram([1, NaN, 2, Infinity, 3, -Infinity], { binCount: 3 });

    expect(h.total).toBe(3);
    expect(h.excluded).toBe(3);
    // The domain is the finite data's, not [-Infinity, Infinity].
    expect(h.binEdges[0]).toBe(1);
    expect(h.binEdges[3]).toBe(3);
  });

  it("collapses a zero-variance ensemble to one bin instead of inventing a width", () => {
    // Any nonzero bin width here would be this function's invention and would
    // read as a spread the data does not have.
    const h = buildImpactHistogram([7, 7, 7, 7], { binCount: 16 });

    expect(h.counts).toHaveLength(1);
    expect(h.counts[0]).toBe(4);
    expect(Array.from(h.binEdges)).toEqual([7, 7]);
    expect(h.total).toBe(4);
  });

  it("honours an explicit domain even when the data is degenerate", () => {
    const h = buildImpactHistogram([7, 7, 7, 7], { binCount: 4, domain: [6, 10] });

    expect(h.counts).toHaveLength(4);
    expect(Array.from(h.counts)).toEqual([0, 4, 0, 0]);
  });

  it("returns an empty histogram when nothing is kept, rather than throwing", () => {
    // A live batch in which no replicate has landed yet is a normal transient.
    const h = buildImpactHistogram([NaN, NaN], { binCount: 8 });

    expect(h.total).toBe(0);
    expect(h.excluded).toBe(2);
    expect(h.counts.reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("rejects a nonsensical bin count or domain", () => {
    expect(() => buildImpactHistogram([1, 2], { binCount: 0 })).toThrow(/positive integer/);
    expect(() => buildImpactHistogram([1, 2], { binCount: 2.5 })).toThrow(/positive integer/);
    expect(() => buildImpactHistogram([1, 2], { domain: [1, 1] })).toThrow(/strictly increasing/);
    expect(() => buildImpactHistogram([1, 2], { domain: [1, NaN] })).toThrow(/finite/);
  });
});

describe("buildImpactScatter (P6.09: the spatial model's ground-plane impacts)", () => {
  it("collapses co-located points to one marker carrying their count", () => {
    // Four points inside one 8 px cell -- screen (601, 401) through
    // (604, 404), all in the cell spanning [600, 608) × [400, 408).
    const xs = [1, 2, 3, 4];
    const ys = [-1, -2, -3, -4];
    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx: 8 });

    expect(s.screenXs).toHaveLength(1);
    expect(s.counts[0]).toBe(4);
    expect(s.maxCount).toBe(4);
    expect(s.kept).toBe(4);
  });

  it("places the marker on a real replicate, not on a centroid of them", () => {
    // The subject of this chart is where shots actually land, so the marker
    // has to be somewhere one of them did. A centroid would be a position no
    // replicate occupies.
    const xs = [3, -3];
    const ys = [3, -3];
    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx: 64 });

    expect(s.screenXs).toHaveLength(1);
    const projected = [
      worldToScreen(CAMERA, VIEWPORT, { x: 3, y: 3 }),
      worldToScreen(CAMERA, VIEWPORT, { x: -3, y: -3 }),
    ];
    expect(projected.map((p) => p.x)).toContain(s.screenXs[0]);
    expect(projected.map((p) => p.y)).toContain(s.screenYs[0]);
    // Emphatically not the centroid, which for this pair is the origin.
    expect(s.screenXs[0]).not.toBe(VIEWPORT.width / 2);
  });

  it("accounts for every input exactly once across kept, culled and excluded", () => {
    const rand = lcg(20260825);
    const n = 500;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    const mask = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      // Deliberately wider than the viewport so some points fall outside it.
      xs[i] = (rand() - 0.5) * 3000;
      ys[i] = (rand() - 0.5) * 2000;
      mask[i] = rand() < 0.9 ? 1 : 0;
    }
    xs[7] = NaN;
    mask[7] = 1;

    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { mask });

    expect(s.kept + s.culled + s.excluded).toBe(n);
    expect(s.counts.reduce((a, b) => a + b, 0)).toBe(s.kept);
    expect(s.culled).toBeGreaterThan(0);
    expect(s.excluded).toBeGreaterThan(0);
  });

  it("culls off-viewport points instead of clamping them to the edge", () => {
    // Clamping would build a dense false band along the frame -- the reader
    // would see structure at the axis limit that is an artefact of the view.
    const xs = [0, 100_000];
    const ys = [0, 0];
    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT);

    expect(s.screenXs).toHaveLength(1);
    expect(s.culled).toBe(1);
    expect(s.screenXs[0]).toBe(VIEWPORT.width / 2);
  });

  it("keeps counts invariant under permuting the ensemble", () => {
    // Density is the quantity a viewer reads off the markers, so it cannot
    // depend on the order replicates happened to finish in.
    const rand = lcg(7);
    const n = 4000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (rand() - 0.5) * 400;
      ys[i] = (rand() - 0.5) * 300;
    }
    const order = Array.from({ length: n }, (_, i) => i);
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(lcg(99 + i)() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    const shuffledXs = Float64Array.from(order, (i) => xs[i]!);
    const shuffledYs = Float64Array.from(order, (i) => ys[i]!);

    const a = buildImpactScatter(xs, ys, CAMERA, VIEWPORT);
    const b = buildImpactScatter(shuffledXs, shuffledYs, CAMERA, VIEWPORT);

    expect(b.kept).toBe(a.kept);
    // Cell-by-cell, in the same row-major emission order: identical.
    expect(Array.from(b.counts)).toEqual(Array.from(a.counts));
    // Marker positions may differ -- but only within one cell.
    for (let i = 0; i < a.screenXs.length; i++) {
      expect(Math.abs(b.screenXs[i]! - a.screenXs[i]!)).toBeLessThan(DEFAULT_IMPACT_CELL_PX);
      expect(Math.abs(b.screenYs[i]! - a.screenYs[i]!)).toBeLessThan(DEFAULT_IMPACT_CELL_PX);
    }
  });

  it("emits markers in row-major cell order, one per occupied cell", () => {
    const rand = lcg(31337);
    const n = 3000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (rand() - 0.5) * 500;
      ys[i] = (rand() - 0.5) * 400;
    }
    const cellPx = DEFAULT_IMPACT_CELL_PX;
    const cols = Math.ceil(VIEWPORT.width / cellPx);
    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx });

    let previous = -1;
    for (let i = 0; i < s.screenXs.length; i++) {
      const col = Math.min(Math.floor(s.screenXs[i]! / cellPx), cols - 1);
      const row = Math.floor(s.screenYs[i]! / cellPx);
      const cell = row * cols + col;
      expect(cell).toBeGreaterThan(previous); // strictly increasing => one per cell
      previous = cell;
    }
  });

  it("treats cellPx as a dial: a finer grid never yields fewer markers", () => {
    // A downsample that ignored its own resolution would pass a one-sided
    // reading of "renders fewer points" while being uncontrollable.
    const rand = lcg(4242);
    const n = 6000;
    const xs = new Float64Array(n);
    const ys = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      xs[i] = (rand() - 0.5) * 300;
      ys[i] = (rand() - 0.5) * 200;
    }

    const coarse = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx: 32 });
    const medium = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx: 8 });
    const fine = buildImpactScatter(xs, ys, CAMERA, VIEWPORT, { cellPx: 2 });

    expect(medium.screenXs.length).toBeGreaterThan(coarse.screenXs.length);
    expect(fine.screenXs.length).toBeGreaterThan(medium.screenXs.length);
    // Every setting still accounts for the same replicates.
    expect(coarse.kept).toBe(fine.kept);
    expect(medium.kept).toBe(fine.kept);
  });

  it("returns a byte-identical result for a repeated call", () => {
    const rand = lcg(11);
    const n = 2000;
    const xs = Float64Array.from({ length: n }, () => (rand() - 0.5) * 400);
    const ys = Float64Array.from({ length: n }, () => (rand() - 0.5) * 300);

    const a = buildImpactScatter(xs, ys, CAMERA, VIEWPORT);
    const b = buildImpactScatter(xs, ys, CAMERA, VIEWPORT);

    expect(Array.from(b.screenXs)).toEqual(Array.from(a.screenXs));
    expect(Array.from(b.screenYs)).toEqual(Array.from(a.screenYs));
    expect(Array.from(b.counts)).toEqual(Array.from(a.counts));
  });

  it("culls everything through a zero-area viewport rather than dividing by it", () => {
    const s = buildImpactScatter([1, 2], [1, 2], CAMERA, { width: 0, height: 0 });

    expect(s.screenXs).toHaveLength(0);
    expect(s.kept).toBe(0);
    expect(s.culled).toBe(2);
    expect(s.maxCount).toBe(0);
  });

  it("handles an empty ensemble", () => {
    const s = buildImpactScatter([], [], CAMERA, VIEWPORT);

    expect(s.screenXs).toHaveLength(0);
    expect(s.kept).toBe(0);
    expect(s.culled).toBe(0);
    expect(s.excluded).toBe(0);
    expect(s.maxCount).toBe(0);
  });

  it("rejects mismatched coordinate arrays and a nonsensical cell size", () => {
    expect(() => buildImpactScatter([1, 2], [1], CAMERA, VIEWPORT)).toThrow(/same length/);
    expect(() => buildImpactScatter([1], [1], CAMERA, VIEWPORT, { cellPx: 0 })).toThrow(
      /finite and positive/,
    );
    expect(() => buildImpactScatter([1], [1], CAMERA, VIEWPORT, { cellPx: NaN })).toThrow(
      /finite and positive/,
    );
  });
});

// P6.09's validation criterion: "scatter renders 1e4 pts < 16 ms (density
// downsample)". 16 ms is one animation frame (§2.6's 16.6 ms) and it is a
// budget for *drawing*. This module's job is to hand the renderer a marker
// count that fits in it, so the criterion is checked here in two halves that
// have to hold together:
//
//   1. the reduction itself costs a small fraction of the frame, and
//   2. it actually reduces -- 1e4 replicates become far fewer markers.
//
// Half 2 is what stops half 1 from being passed by a function that returns
// its input unchanged. Such a function would be *faster* than this one and
// would leave the renderer 1e4 draw calls, which is the problem the criterion
// exists to prevent.
//
// Budget rationale, following `trajectory-decimation.test.ts`'s history: that
// test's 1 ms budget failed repeatedly on GitHub-hosted runners measuring
// 1.5-2.7 ms, and was recalibrated to 5 ms. The measurement below is
// best-of-15-after-20-warmups like that one. Measured in this sandbox at
// 1e4 points: best 0.62 ms, median 0.72 ms, worst-of-15 1.44 ms. Keeping the
// criterion's own 16 ms therefore leaves ~26x headroom on the best and ~11x
// on the worst single trial seen -- comfortably more than the ~2-3x by which
// hosted runners outran the decimation budget, so that failure mode cannot
// reach this one, while a real algorithmic regression (losing the O(n) single
// pass, or emitting one marker per point) still fails it loudly.
const SCATTER_FRAME_BUDGET_MS = 16;

describe(`performance (P6.09 validation: 1e4 impact points inside a ${SCATTER_FRAME_BUDGET_MS} ms frame)`, () => {
  const n = 10_000;
  const rand = lcg(20260825);
  const xs = new Float64Array(n);
  const ys = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // A dispersion ellipse of the shape a real jittered ensemble makes:
    // Box-Muller normals, wider downrange than cross-range, centred in view.
    const u1 = Math.max(rand(), Number.MIN_VALUE);
    const u2 = rand();
    const r = Math.sqrt(-2 * Math.log(u1));
    xs[i] = r * Math.cos(2 * Math.PI * u2) * 120;
    ys[i] = r * Math.sin(2 * Math.PI * u2) * 60;
  }

  it(`downsamples ${n} points in well under the frame budget`, () => {
    for (let warmup = 0; warmup < 20; warmup++) {
      buildImpactScatter(xs, ys, CAMERA, VIEWPORT);
    }

    let best = Infinity;
    for (let trial = 0; trial < 15; trial++) {
      const start = performance.now();
      buildImpactScatter(xs, ys, CAMERA, VIEWPORT);
      const elapsed = performance.now() - start;
      if (elapsed < best) best = elapsed;
    }

    expect(best).toBeLessThan(SCATTER_FRAME_BUDGET_MS);
  });

  it(`bounds the marker count by the viewport rather than by the ensemble`, () => {
    // **What the downsample guarantees, stated precisely, because the naive
    // reading of "density downsample" over-promises.** It does not cut the
    // marker count by a fixed ratio; the ratio depends entirely on how many
    // replicates share a cell, and therefore on the zoom. At the default 4 px
    // over this dispersion, 1e4 points occupy 5224 cells -- a 1.9x cut, not a
    // dramatic one, and a tighter or looser view would give a different
    // number. What *is* guaranteed, and what the 16 ms criterion actually
    // needs, is the ceiling: markers never exceed the occupied cells, so the
    // render cost stops growing once the ensemble saturates the grid.
    const s = buildImpactScatter(xs, ys, CAMERA, VIEWPORT);

    // Almost all of this ensemble is on screen, so the speed above is not
    // culling in disguise.
    expect(s.kept).toBeGreaterThan(0.99 * n);
    // A real reduction at this zoom, which a pass-through implementation
    // (marker per point) would fail.
    expect(s.screenXs.length).toBeLessThan(0.75 * n);

    // Saturation is the property that matters: replaying the same ensemble
    // 2x and 4x over multiplies the replicates without adding one marker.
    for (const repeats of [2, 4]) {
      const repeatedXs = Float64Array.from({ length: repeats * n }, (_, i) => xs[i % n]!);
      const repeatedYs = Float64Array.from({ length: repeats * n }, (_, i) => ys[i % n]!);
      const repeated = buildImpactScatter(repeatedXs, repeatedYs, CAMERA, VIEWPORT);
      expect(repeated.screenXs.length).toBe(s.screenXs.length);
      expect(repeated.kept).toBe(repeats * s.kept);
      expect(repeated.maxCount).toBe(repeats * s.maxCount);
    }
  });

  it("projects points exactly as worldToScreen does", () => {
    // `buildImpactScatter` inlines the camera transform for speed, and an
    // inlined copy is a copy that can drift. A marker half a pixel off its
    // own trajectory's landing point is not a visible bug, it is a wrong
    // chart, so the two formulas are compared directly.
    const camera: Camera2DState = { centerX: 17, centerY: -4, scaleX: 2.5, scaleY: 0.8 };
    const world = [
      { x: 17, y: -4 },
      { x: 20.5, y: 100 },
      { x: -33, y: -260 },
    ];
    const s = buildImpactScatter(
      world.map((p) => p.x),
      world.map((p) => p.y),
      camera,
      VIEWPORT,
      { cellPx: 1 },
    );
    expect(s.kept).toBe(world.length);

    const expected = world
      .map((p) => worldToScreen(camera, VIEWPORT, p))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    const actual = Array.from(s.screenXs, (x, i) => ({ x, y: s.screenYs[i]! })).sort(
      (a, b) => a.y - b.y || a.x - b.x,
    );
    expect(actual).toEqual(expected);
  });
});
