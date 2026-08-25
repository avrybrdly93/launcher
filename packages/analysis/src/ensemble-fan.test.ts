import { describe, it, expect } from "vitest";
import type { Trajectory } from "@ballista/solverkit";
import {
  DEFAULT_FAN_LEVELS,
  buildCommonGrid,
  buildEnsembleFan,
  quantileOfSorted,
  resampleOnGrid,
} from "./ensemble-fan.js";

/**
 * Builds a `Trajectory` from times and per-channel value functions, so a test
 * can state the analytic curve it wants sampled rather than typing rows.
 * `channels[k](t)` is evaluated at each time.
 */
function makeTrajectory(
  times: readonly number[],
  channels: readonly ((t: number) => number)[],
): Trajectory {
  return {
    nSteps: times.length,
    t: Float64Array.from(times),
    channels: channels.map((f) => Float64Array.from(times, f)),
  };
}

/** A ground launch with no drag: y(t) = v*t - g t²/2, vy(t) = v - g t. */
function ballistic(
  v: number,
  g = 9.81,
  times: readonly number[] = [0, 0.5, 1.2, 1.9, 2.4],
): Trajectory {
  return makeTrajectory(times, [(t) => v * t - 0.5 * g * t * t, (t) => v - g * t]);
}

describe("quantileOfSorted", () => {
  it("is exact at the ends", () => {
    const sorted = [1, 2, 3, 10];
    expect(quantileOfSorted(sorted, 0)).toBe(1);
    expect(quantileOfSorted(sorted, 1)).toBe(10);
  });

  it("matches the type-7 estimator NumPy and R use", () => {
    // numpy.percentile([1,2,3,4], [25,50,75]) -> 1.75, 2.5, 3.25
    const sorted = [1, 2, 3, 4];
    expect(quantileOfSorted(sorted, 0.25)).toBeCloseTo(1.75, 15);
    expect(quantileOfSorted(sorted, 0.5)).toBeCloseTo(2.5, 15);
    expect(quantileOfSorted(sorted, 0.75)).toBeCloseTo(3.25, 15);
  });

  it("reproduces an order statistic bit for bit when the index is exact", () => {
    // n = 5 puts p = 0.25 exactly on index 1, so no blend happens and the
    // stored value must come back unrounded. `a + frac*(b-a)` gives that;
    // `(1-frac)*a + frac*b` would not, for a general a.
    const sorted = [0.1, 0.30000000000000004, 0.5, 0.7, 0.9];
    expect(quantileOfSorted(sorted, 0.25)).toBe(0.30000000000000004);
  });

  it("is non-decreasing in p, which is what makes bands nest", () => {
    const sorted = [-3, -1, 0, 0, 2, 7, 7.5, 100];
    let previous = Number.NEGATIVE_INFINITY;
    for (let p = 0; p <= 1.0000001; p += 0.01) {
      const q = quantileOfSorted(sorted, Math.min(p, 1));
      expect(q).toBeGreaterThanOrEqual(previous);
      previous = q;
    }
  });

  it("returns the single sample for n = 1 and NaN for n = 0", () => {
    expect(quantileOfSorted([42], 0.05)).toBe(42);
    expect(quantileOfSorted([42], 0.95)).toBe(42);
    expect(Number.isNaN(quantileOfSorted([], 0.5))).toBe(true);
  });
});

describe("resampleOnGrid", () => {
  it("reproduces the recorded rows exactly at their own times", () => {
    const trajectory = ballistic(20);
    const out = resampleOnGrid(trajectory, trajectory.t, {
      valueChannel: 0,
      derivativeChannel: 1,
    });
    for (let i = 0; i < trajectory.nSteps; i++) {
      expect(out[i]).toBe(trajectory.channels[0]![i]);
    }
  });

  it("interpolates a cubic exactly when given its derivative channel", () => {
    // The Hermite interpolant is the unique cubic matching both values and
    // both slopes, so on a genuine cubic it is not an approximation at all --
    // it is exact, to rounding, at every interior point. That is the sharpest
    // statement available that the basis functions are right, and no linear
    // interpolant can pass it.
    const cubic = (t: number) => 2 * t * t * t - 5 * t * t + 3 * t - 7;
    const slope = (t: number) => 6 * t * t - 10 * t + 3;
    const trajectory = makeTrajectory([0, 1.3, 2.9, 4], [cubic, slope]);
    const grid = Float64Array.from({ length: 41 }, (_, i) => (4 * i) / 40);
    const out = resampleOnGrid(trajectory, grid, { valueChannel: 0, derivativeChannel: 1 });
    for (let i = 0; i < grid.length; i++) {
      expect(out[i]).toBeCloseTo(cubic(grid[i]!), 10);
    }
  });

  it("is measurably better than the linear fallback on the ballistic arc", () => {
    // The counterexample the exact-cubic case cannot supply: that the
    // derivative channel is actually being *used*. A parabola is degree 2, so
    // Hermite is exact on it and linear is not; the two must therefore
    // disagree, and by a margin, or `derivativeChannel` is being ignored.
    const g = 9.81;
    const exact = (t: number) => 20 * t - 0.5 * g * t * t;
    const trajectory = ballistic(20, g, [0, 1.0, 2.0, 3.0, 4.0]);
    const grid = Float64Array.from([0.5, 1.5, 2.5, 3.5]);
    const cubic = resampleOnGrid(trajectory, grid, { valueChannel: 0, derivativeChannel: 1 });
    const linear = resampleOnGrid(trajectory, grid, { valueChannel: 0 });

    let worstCubic = 0;
    let worstLinear = 0;
    for (let i = 0; i < grid.length; i++) {
      worstCubic = Math.max(worstCubic, Math.abs(cubic[i]! - exact(grid[i]!)));
      worstLinear = Math.max(worstLinear, Math.abs(linear[i]! - exact(grid[i]!)));
    }
    // Hermite is exact on a parabola; linear is off by g h²/8 = 1.226 m at a
    // step midpoint with h = 1.
    expect(worstCubic).toBeLessThan(1e-12);
    expect(worstLinear).toBeGreaterThan(1.2);
  });

  it("returns NaN outside the trajectory's own span rather than clamping", () => {
    const trajectory = ballistic(20, 9.81, [1, 2, 3]);
    const out = resampleOnGrid(trajectory, [0.5, 1, 2, 3, 3.5], {
      valueChannel: 0,
      derivativeChannel: 1,
    });
    expect(Number.isNaN(out[0]!)).toBe(true);
    expect(Number.isNaN(out[4]!)).toBe(true);
    expect(Number.isFinite(out[1]!)).toBe(true);
    expect(Number.isFinite(out[3]!)).toBe(true);
    // Clamping would have repeated the endpoints here, which is the shape the
    // NaN exists to prevent.
    expect(out[0]).not.toBe(out[1]);
    expect(out[4]).not.toBe(out[3]);
  });

  it("handles a zero-length step without dividing by it", () => {
    // A terminal event localized onto its own left endpoint records the same
    // time twice. The left value is the answer; a NaN here would poison every
    // band at that grid point.
    const trajectory = makeTrajectory([0, 1, 1, 2], [(t) => t * 10, () => 10]);
    const out = resampleOnGrid(trajectory, [0.5, 1, 1.5], { valueChannel: 0 });
    expect(out[0]).toBeCloseTo(5, 12);
    expect(out[1]).toBe(10);
    expect(Number.isFinite(out[2]!)).toBe(true);
  });

  it("rejects a channel index that does not exist", () => {
    const trajectory = ballistic(20);
    expect(() => resampleOnGrid(trajectory, [0.5], { valueChannel: 2 })).toThrow(RangeError);
    expect(() =>
      resampleOnGrid(trajectory, [0.5], { valueChannel: 0, derivativeChannel: 9 }),
    ).toThrow(RangeError);
  });

  it("rejects a grid that is not strictly ascending or not finite", () => {
    const trajectory = ballistic(20);
    expect(() => resampleOnGrid(trajectory, [1, 1], { valueChannel: 0 })).toThrow(RangeError);
    expect(() => resampleOnGrid(trajectory, [2, 1], { valueChannel: 0 })).toThrow(RangeError);
    expect(() => resampleOnGrid(trajectory, [Number.NaN], { valueChannel: 0 })).toThrow(RangeError);
    expect(() => resampleOnGrid(trajectory, [], { valueChannel: 0 })).toThrow(RangeError);
  });

  it("returns all-NaN for a trajectory with no rows", () => {
    const empty: Trajectory = {
      nSteps: 0,
      t: new Float64Array(0),
      channels: [new Float64Array(0)],
    };
    const out = resampleOnGrid(empty, [0, 1], { valueChannel: 0 });
    expect([...out].every(Number.isNaN)).toBe(true);
  });
});

describe("buildCommonGrid", () => {
  it("spans the union of the ensemble and hits both endpoints exactly", () => {
    const grid = buildCommonGrid([ballistic(20, 9.81, [0, 2]), ballistic(30, 9.81, [0.5, 5])], 9);
    expect(grid[0]).toBe(0);
    expect(grid[grid.length - 1]).toBe(5);
    expect(grid.length).toBe(9);
  });

  it("is strictly ascending, so it is a legal grid for the resampler", () => {
    const grid = buildCommonGrid([ballistic(20, 9.81, [0, 3.3])], 257);
    for (let i = 1; i < grid.length; i++) expect(grid[i]!).toBeGreaterThan(grid[i - 1]!);
  });

  it("rejects an empty ensemble, a degenerate span, and fewer than two points", () => {
    expect(() => buildCommonGrid([], 4)).toThrow(RangeError);
    expect(() => buildCommonGrid([ballistic(20, 9.81, [1, 2])], 1)).toThrow(RangeError);
    const instant = makeTrajectory([2], [(t) => t]);
    expect(() => buildCommonGrid([instant], 4)).toThrow(RangeError);
  });
});

describe("buildEnsembleFan", () => {
  /** Nine ballistic arcs whose launch speeds are symmetric about 20 m/s. */
  function symmetricEnsemble(): Trajectory[] {
    const offsets = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
    return offsets.map((d) => ballistic(20 + d, 9.81, [0, 0.4, 0.9, 1.5, 2.0]));
  }

  it("bands are nested at every grid point — the criterion, first half", () => {
    const ensemble = symmetricEnsemble();
    const grid = buildCommonGrid(ensemble, 64);
    const fan = buildEnsembleFan(ensemble, grid, { valueChannel: 0, derivativeChannel: 1 });

    expect(fan.bands.length).toBe(DEFAULT_FAN_LEVELS.length);
    for (let g = 0; g < grid.length; g++) {
      for (let k = 1; k < fan.bands.length; k++) {
        const inner = fan.bands[k - 1]![g]!;
        const outer = fan.bands[k]![g]!;
        if (Number.isNaN(inner) && Number.isNaN(outer)) continue;
        expect(outer).toBeGreaterThanOrEqual(inner);
      }
    }
  });

  it("bands are monotone in the level for any level set, not just the default", () => {
    // Nesting must not be a property of the five levels the task happens to
    // name. Twenty-one levels, including both endpoints.
    const levels = Array.from({ length: 21 }, (_, i) => i / 20);
    const ensemble = symmetricEnsemble();
    const grid = buildCommonGrid(ensemble, 32);
    const fan = buildEnsembleFan(ensemble, grid, {
      valueChannel: 0,
      derivativeChannel: 1,
      levels,
    });
    for (let g = 0; g < grid.length; g++) {
      for (let k = 1; k < levels.length; k++) {
        const inner = fan.bands[k - 1]![g]!;
        const outer = fan.bands[k]![g]!;
        if (Number.isNaN(inner) && Number.isNaN(outer)) continue;
        expect(outer).toBeGreaterThanOrEqual(inner);
      }
    }
    // ... and the outermost pair is the sample min and max, exactly.
    const g = 5;
    const column = ensemble.map(
      (tr) => resampleOnGrid(tr, grid, { valueChannel: 0, derivativeChannel: 1 })[g]!,
    );
    expect(fan.bands[0]![g]).toBe(Math.min(...column));
    expect(fan.bands[levels.length - 1]![g]).toBe(Math.max(...column));
  });

  it("median equals the nominal trajectory for symmetric inputs — the criterion, second half", () => {
    // Nine arcs whose speeds are 16..24 in steps of 1: the median speed is
    // exactly the nominal 20, and every replicate shares the same recorded
    // times, so the median band must land on the nominal arc to rounding at
    // every grid point. This is an equality, not a tolerance on a spread.
    const ensemble = symmetricEnsemble();
    const nominal = ballistic(20, 9.81, [0, 0.4, 0.9, 1.5, 2.0]);
    const grid = buildCommonGrid(ensemble, 40);
    const fan = buildEnsembleFan(ensemble, grid, { valueChannel: 0, derivativeChannel: 1 });
    const nominalOnGrid = resampleOnGrid(nominal, grid, { valueChannel: 0, derivativeChannel: 1 });

    const medianIndex = DEFAULT_FAN_LEVELS.indexOf(0.5);
    expect(medianIndex).toBeGreaterThanOrEqual(0);
    for (let g = 0; g < grid.length; g++) {
      expect(fan.bands[medianIndex]![g]).toBeCloseTo(nominalOnGrid[g]!, 12);
    }
  });

  it("the median is not merely the mean wearing a different name", () => {
    // The counterexample the symmetric case cannot supply. Skew the ensemble
    // by replacing one arc with a far one: the median barely moves, the mean
    // moves a lot. An implementation that averaged instead of ordering would
    // pass every symmetric test in this file.
    const ensemble = symmetricEnsemble();
    ensemble[8] = ballistic(120, 9.81, [0, 0.4, 0.9, 1.5, 2.0]);
    const grid = buildCommonGrid(ensemble, 16);
    const fan = buildEnsembleFan(ensemble, grid, { valueChannel: 0, derivativeChannel: 1 });

    const g = 8;
    const column = ensemble.map(
      (tr) => resampleOnGrid(tr, grid, { valueChannel: 0, derivativeChannel: 1 })[g]!,
    );
    const mean = column.reduce((a, b) => a + b, 0) / column.length;
    const median = fan.bands[DEFAULT_FAN_LEVELS.indexOf(0.5)]![g]!;
    expect(median).toBeLessThan(mean);
    // The outlier is 100 m/s beyond the rest, so the gap is not marginal.
    expect(mean - median).toBeGreaterThan(1);
  });

  it("counts the replicates behind each band and reports the common support", () => {
    // Three arcs that stop at different times: the ensemble thins, and a
    // consumer must be able to see where.
    const ensemble = [
      makeTrajectory([0, 1, 2], [(t) => t, () => 1]),
      makeTrajectory([0, 1, 2, 3], [(t) => t, () => 1]),
      makeTrajectory([0, 1, 2, 3, 4], [(t) => t, () => 1]),
    ];
    const grid = Float64Array.from([0, 1, 2, 2.5, 3, 3.5, 4]);
    const fan = buildEnsembleFan(ensemble, grid, { valueChannel: 0, derivativeChannel: 1 });

    expect([...fan.sampleCount]).toEqual([3, 3, 3, 2, 2, 1, 1]);
    expect(fan.replicateCount).toBe(3);
    expect(fan.commonSupportEnd).toBe(2);
    // Past the common support the bands are still finite -- conditional on
    // survival, which is why the count is carried beside them.
    expect(Number.isFinite(fan.bands[0]![6]!)).toBe(true);
  });

  it("a grid point no replicate reaches yields NaN bands and a zero count", () => {
    const ensemble = [makeTrajectory([0, 1], [(t) => t, () => 1])];
    const fan = buildEnsembleFan(ensemble, [0, 1, 2], { valueChannel: 0, derivativeChannel: 1 });
    expect(fan.sampleCount[2]).toBe(0);
    for (const band of fan.bands) expect(Number.isNaN(band[2]!)).toBe(true);
    expect(fan.commonSupportEnd).toBe(1);
  });

  it("commonSupportEnd is NaN when the replicates never all overlap on the grid", () => {
    const ensemble = [
      makeTrajectory([0, 1], [(t) => t, () => 1]),
      makeTrajectory([5, 6], [(t) => t, () => 1]),
    ];
    const fan = buildEnsembleFan(ensemble, [0.5, 5.5], { valueChannel: 0, derivativeChannel: 1 });
    expect([...fan.sampleCount]).toEqual([1, 1]);
    expect(Number.isNaN(fan.commonSupportEnd)).toBe(true);
  });

  it("a NaN in one replicate thins those columns rather than voiding them", () => {
    const ensemble = [
      makeTrajectory([0, 1, 2], [(t) => t, () => 1]),
      makeTrajectory([0, 1, 2], [(t) => (t === 1 ? Number.NaN : t + 10), () => 1]),
    ];
    const fan = buildEnsembleFan(ensemble, [0, 1, 2], { valueChannel: 0 });

    // The poisoned row takes out its two neighbouring intervals *including
    // their far endpoints*, because the interpolation weights it by zero and
    // `0 * NaN` is `NaN`, not `0`. So all three grid points here thin to one
    // sample, not just the middle one. Asserted rather than special-cased:
    // the interval either side of an unusable row has no trustworthy value in
    // it, and a short-circuit that returned `y0` at exactly `t0` while
    // returning NaN an instant later would be a stranger surface than this.
    expect([...fan.sampleCount]).toEqual([1, 1, 1]);
    // The surviving replicate is what every band reports -- the column is
    // thinned, not voided, which is the property that matters.
    expect(fan.bands[0]![0]).toBe(0);
    expect(fan.bands[0]![1]).toBe(1);
    expect(fan.bands[4]![2]).toBe(2);
    expect(fan.replicateCount).toBe(2);
    expect(Number.isNaN(fan.commonSupportEnd)).toBe(true);
  });

  it("does not mutate the grid it was handed, and freezes what it returns", () => {
    const grid = Float64Array.from([0, 1, 2]);
    const fan = buildEnsembleFan([makeTrajectory([0, 1, 2], [(t) => -t, () => -1])], grid, {
      valueChannel: 0,
    });
    expect(fan.grid).not.toBe(grid);
    expect([...grid]).toEqual([0, 1, 2]);
    expect(Object.isFrozen(fan)).toBe(true);
    expect(Object.isFrozen(fan.bands)).toBe(true);
  });

  it("rejects levels that are not ascending values in [0, 1]", () => {
    const ensemble = [ballistic(20)];
    const grid = [0.5, 1];
    expect(() => buildEnsembleFan(ensemble, grid, { valueChannel: 0, levels: [] })).toThrow(
      RangeError,
    );
    expect(() =>
      buildEnsembleFan(ensemble, grid, { valueChannel: 0, levels: [0.5, 0.25] }),
    ).toThrow(RangeError);
    expect(() => buildEnsembleFan(ensemble, grid, { valueChannel: 0, levels: [0.5, 0.5] })).toThrow(
      RangeError,
    );
    expect(() => buildEnsembleFan(ensemble, grid, { valueChannel: 0, levels: [1.5] })).toThrow(
      RangeError,
    );
  });

  it("rejects an empty ensemble", () => {
    expect(() => buildEnsembleFan([], [0, 1], { valueChannel: 0 })).toThrow(RangeError);
  });

  it("the bands really are quantiles of the resampled columns, checked directly", () => {
    // The end-to-end check: recompute one column by hand from the resampler's
    // own output and compare against every band. Everything above tests a
    // property of the bands; this tests the value.
    const ensemble = symmetricEnsemble();
    const grid = buildCommonGrid(ensemble, 11);
    const fan = buildEnsembleFan(ensemble, grid, { valueChannel: 0, derivativeChannel: 1 });
    const g = 4;
    const column = ensemble
      .map((tr) => resampleOnGrid(tr, grid, { valueChannel: 0, derivativeChannel: 1 })[g]!)
      .sort((a, b) => a - b);
    for (let k = 0; k < DEFAULT_FAN_LEVELS.length; k++) {
      expect(fan.bands[k]![g]).toBe(quantileOfSorted(column, DEFAULT_FAN_LEVELS[k]!));
    }
  });
});
