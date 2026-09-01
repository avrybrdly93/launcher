import { describe, it, expect } from "vitest";
import { PCG32 } from "@ballista/engine";
import type { Trajectory } from "@ballista/solverkit";
import { buildCommonGrid } from "./ensemble-fan.js";
import {
  adjustedRandIndex,
  buildCommonSupportGrid,
  buildTrajectoryFeatures,
  canonicaliseLabels,
  clusterTrajectories,
  kMeans,
  type NamedObservable,
} from "./trajectory-clustering.js";

const G = 9.81;

/**
 * A drag-free ballistic arc, recorded from launch to impact.
 *
 * Channel 0 is `y`, channel 1 is `vy = dy/dt`, so `resampleOnGrid` gets the
 * derivative channel it needs for cubic Hermite rather than the linear
 * fallback. Channels 2 and 3 are `x` and `vx`, recorded so that *range* is a
 * real observable of the fixture — without them `x` is unrecoverable, since
 * `T = 2 v sinθ / g` makes the time of flight and `vy0` perfectly collinear
 * and neither one pins down `θ` and `v` separately.
 *
 * Times are sampled uniformly on `[0, T]`, so the last recorded row sits
 * exactly at impact.
 */
function arc(speed: number, degrees: number, rowCount = 24): Trajectory {
  const theta = (degrees * Math.PI) / 180;
  const vy0 = speed * Math.sin(theta);
  const vx = speed * Math.cos(theta);
  const flightTime = (2 * vy0) / G;
  const t = Float64Array.from({ length: rowCount }, (_, i) => (flightTime * i) / (rowCount - 1));
  return {
    nSteps: rowCount,
    t,
    channels: [
      Float64Array.from(t, (time) => vy0 * time - 0.5 * G * time * time),
      Float64Array.from(t, (time) => vy0 - G * time),
      Float64Array.from(t, (time) => vx * time),
      Float64Array.from(t, () => vx),
    ],
  };
}

const TIME_OF_FLIGHT: NamedObservable = {
  name: "timeOfFlight",
  of: (trajectory) => trajectory.t[trajectory.nSteps - 1] as number,
};

const APEX_HEIGHT: NamedObservable = {
  name: "apexHeight",
  of: (trajectory) => {
    const y = trajectory.channels[0] as Float64Array;
    let best = Number.NEGATIVE_INFINITY;
    for (let i = 0; i < trajectory.nSteps; i++) best = Math.max(best, y[i] as number);
    return best;
  },
};

/**
 * The labeled fixture P6.21's criterion is stated against: a bimodal ensemble
 * of two arcs.
 *
 * The two modes are launched at **complementary angles**, 30° and 60°, and
 * that choice is the point of the fixture rather than a detail. In vacuum,
 * complementary angles give *identical range* — `v² sin(2θ)/g` is symmetric
 * about 45° — so the single most obvious observable cannot separate these two
 * populations at all. What separates them is the shape of `y(t)` and the time
 * of flight, which differ by a factor of `sin 60° / sin 30° = 1.73`. A feature
 * vector that quietly collapsed to "range" would score near zero here, which
 * is exactly what makes this a test rather than a demonstration.
 *
 * Both modes get seeded jitter on speed and angle so the clusters have real
 * spread and are not two repeated points.
 */
function twoArcEnsemble(perMode = 40, seed = 20260901n) {
  const rng = new PCG32(seed);
  const trajectories: Trajectory[] = [];
  const labels: number[] = [];
  for (let i = 0; i < perMode; i++) {
    trajectories.push(arc(60 + rng.nextGaussian() * 1.5, 30 + rng.nextGaussian() * 2));
    labels.push(0);
  }
  for (let i = 0; i < perMode; i++) {
    trajectories.push(arc(60 + rng.nextGaussian() * 1.5, 60 + rng.nextGaussian() * 2));
    labels.push(1);
  }
  return { trajectories, labels };
}

const SHAPE: { valueChannel: number; derivativeChannel: number } = {
  valueChannel: 0,
  derivativeChannel: 1,
};

describe("buildCommonSupportGrid", () => {
  it("spans the intersection of the supports, not the union", () => {
    const short = arc(40, 30);
    const long = arc(60, 60);
    const shortEnd = short.t[short.nSteps - 1] as number;

    const grid = buildCommonSupportGrid([short, long], 9);
    expect(grid[0]).toBe(0);
    // The last point is the *earliest* impact, so every replicate still has a
    // value there. buildCommonGrid would run to the latest impact instead.
    expect(grid[grid.length - 1]).toBe(shortEnd);
    expect(buildCommonGrid([short, long], 9)[8]).toBeGreaterThan(shortEnd);
  });

  it("hits the endpoint exactly rather than accumulating a step", () => {
    const a = arc(50, 45);
    const end = a.t[a.nSteps - 1] as number;
    const grid = buildCommonSupportGrid([a], 101);
    expect(grid[100]).toBe(end);
  });

  it("is strictly ascending", () => {
    const grid = buildCommonSupportGrid([arc(50, 45), arc(55, 40)], 33);
    for (let i = 1; i < grid.length; i++) {
      expect(grid[i] as number).toBeGreaterThan(grid[i - 1] as number);
    }
  });

  it("refuses an ensemble whose supports do not overlap", () => {
    const early: Trajectory = {
      nSteps: 2,
      t: Float64Array.from([0, 1]),
      channels: [Float64Array.from([0, 1]), Float64Array.from([1, 1])],
    };
    const late: Trajectory = {
      nSteps: 2,
      t: Float64Array.from([5, 6]),
      channels: [Float64Array.from([0, 1]), Float64Array.from([1, 1])],
    };
    expect(() => buildCommonSupportGrid([early, late], 4)).toThrow(/do not overlap/);
  });

  it("rejects a degenerate request rather than returning a one-point grid", () => {
    expect(() => buildCommonSupportGrid([], 4)).toThrow(/at least one/);
    expect(() => buildCommonSupportGrid([arc(50, 45)], 1)).toThrow(/>= 2/);
    expect(() => buildCommonSupportGrid([arc(50, 45)], 2.5)).toThrow(/integer/);
  });
});

describe("buildTrajectoryFeatures", () => {
  it("standardises every column to zero mean and unit variance before weighting", () => {
    const { trajectories } = twoArcEnsemble(10);
    const features = buildTrajectoryFeatures(trajectories, {
      ...SHAPE,
      gridPointCount: 8,
      observables: [TIME_OF_FLIGHT],
      // Weighting is what would otherwise disturb the unit variance being
      // asserted here; the standardisation itself is the subject.
      blockWeights: { shape: 1, observable: 1 },
    });

    const { data, rowCount, dimension } = features;
    let constantColumns = 0;
    for (let j = 0; j < dimension; j++) {
      let sum = 0;
      for (let i = 0; i < rowCount; i++) sum += data[i * dimension + j] as number;
      // Every column is centred, constant ones included.
      expect(sum / rowCount).toBeCloseTo(0, 12);

      let sumSquares = 0;
      for (let i = 0; i < rowCount; i++) {
        const v = data[i * dimension + j] as number;
        sumSquares += v * v;
      }
      const deviation = Math.sqrt(sumSquares / rowCount);
      if (deviation === 0) {
        // The `y(t=0) = 0` column: constant across the ensemble because every
        // replicate launches from the ground. Unit variance is unreachable for
        // it and the module leaves it at zero rather than dividing by zero.
        constantColumns++;
      } else {
        expect(deviation).toBeCloseTo(1, 12);
      }
    }
    // Pinned, so that a change making *more* columns degenerate is a failure
    // rather than a quietly weaker assertion.
    expect(constantColumns).toBe(1);
  });

  it("centres a constant column instead of dividing by its zero deviation", () => {
    // Two identical arcs make every column constant. The naive standardiser
    // divides by zero here and fills the matrix with NaN, which kMeans would
    // then reject -- so this asserts the feature builder never gets there.
    const identical = [arc(50, 45), arc(50, 45)];
    const features = buildTrajectoryFeatures(identical, { ...SHAPE, gridPointCount: 6 });
    for (const value of features.data) expect(Number.isFinite(value)).toBe(true);
    for (const value of features.data) expect(value).toBe(0);
    for (const deviation of features.deviations) expect(deviation).toBe(1);
  });

  it("refuses a grid that leaves a replicate's support rather than emitting NaN", () => {
    // This is the module's headline safety property, and the failure it
    // prevents is silent: a NaN feature makes every distance involving that
    // row NaN, `NaN < best` is false, and k-means returns a confident,
    // meaningless partition. Asserted against the *union* grid, because that
    // is the one a caller reaching for the P6.10 helper would naturally pass.
    const { trajectories } = twoArcEnsemble(4);
    const unionGrid = buildCommonGrid(trajectories, 16);
    expect(() => buildTrajectoryFeatures(trajectories, { ...SHAPE, grid: unionGrid })).toThrow(
      /no finite value/,
    );
  });

  it("names the offending observable rather than the column index", () => {
    const broken: NamedObservable = { name: "alwaysNaN", of: () => Number.NaN };
    expect(() =>
      buildTrajectoryFeatures([arc(50, 45), arc(50, 30)], {
        ...SHAPE,
        gridPointCount: 4,
        observables: [broken],
      }),
    ).toThrow(/alwaysNaN/);
  });

  it("equalises the two blocks' total weight by default", () => {
    const { trajectories } = twoArcEnsemble(10);
    const shapeColumns = 16;
    const features = buildTrajectoryFeatures(trajectories, {
      ...SHAPE,
      gridPointCount: shapeColumns,
      observables: [TIME_OF_FLIGHT, APEX_HEIGHT],
    });

    // After standardisation each column has unit variance; the default weights
    // scale by 1/sqrt(blockSize), so each block's summed squared magnitude is
    // the same. Without this the 16 shape columns would outvote 2 observables
    // 8:1 on dimension count alone.
    //
    // The expected ratio is 15/16, not 1, and the missing sixteenth is real:
    // every replicate launches from the ground, so `y(t=0) = 0` for all of
    // them and the first shape column is *constant*. Standardisation centres
    // it to zero and it contributes no energy — the zero-variance path in
    // buildTrajectoryFeatures, seen from the outside. Asserting 1 here would
    // be asserting that a constant column carries information.
    const { data, rowCount, dimension } = features;
    let shapeEnergy = 0;
    let observableEnergy = 0;
    let constantShapeColumns = 0;
    for (let j = 0; j < shapeColumns; j++) {
      let allZero = true;
      for (let i = 0; i < rowCount; i++) {
        if ((data[i * dimension + j] as number) !== 0) {
          allZero = false;
          break;
        }
      }
      if (allZero) constantShapeColumns++;
    }
    expect(constantShapeColumns).toBe(1);

    for (let i = 0; i < rowCount; i++) {
      for (let j = 0; j < dimension; j++) {
        const v = data[i * dimension + j] as number;
        if (j < shapeColumns) shapeEnergy += v * v;
        else observableEnergy += v * v;
      }
    }
    expect(shapeEnergy / observableEnergy).toBeCloseTo(
      (shapeColumns - constantShapeColumns) / shapeColumns,
      10,
    );
  });

  it("labels columns so a feature can be traced back to a time or a name", () => {
    const features = buildTrajectoryFeatures([arc(50, 45), arc(50, 30)], {
      ...SHAPE,
      gridPointCount: 3,
      observables: [TIME_OF_FLIGHT],
    });
    expect(features.columnNames).toHaveLength(4);
    expect(features.columnNames[0]).toMatch(/^y\(t=/);
    expect(features.columnNames[3]).toBe("timeOfFlight");
  });
});

describe("adjustedRandIndex", () => {
  it("is 1 for identical partitions and unchanged by relabelling", () => {
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 0, 1, 1])).toBe(1);
    expect(adjustedRandIndex([0, 0, 1, 1], [1, 1, 0, 0])).toBe(1);
    expect(adjustedRandIndex([0, 0, 1, 1], [7, 7, 3, 3])).toBe(1);
  });

  it("matches scikit-learn's documented value for a split cluster", () => {
    // sklearn.metrics.adjusted_rand_score([0,0,1,1], [0,0,1,2]) -> 0.5714285714285715
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 0, 1, 2])).toBeCloseTo(0.5714285714285715, 12);
  });

  it("goes negative when agreement is worse than chance", () => {
    // sklearn.metrics.adjusted_rand_score([0,0,1,1], [0,1,0,1]) -> -0.5
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 1, 0, 1])).toBeCloseTo(-0.5, 12);
  });

  it("is 0, not high, for a partition that agrees only as much as chance", () => {
    // The whole reason the criterion is stated in ARI rather than the raw Rand
    // index: the unadjusted Rand index of these two is 0.5, which reads like
    // half-right and means nothing.
    expect(adjustedRandIndex([0, 0, 1, 1], [0, 1, 1, 0])).toBeCloseTo(-0.5, 12);
    expect(adjustedRandIndex([0, 1, 2, 3], [0, 0, 1, 1])).toBeCloseTo(0, 12);
  });

  it("returns 1 when both partitions are degenerate in the same way", () => {
    expect(adjustedRandIndex([0, 0, 0], [0, 0, 0])).toBe(1);
    expect(adjustedRandIndex([0, 1, 2], [5, 6, 7])).toBe(1);
  });

  it("refuses mismatched or empty inputs", () => {
    expect(() => adjustedRandIndex([0, 1], [0, 1, 2])).toThrow(/same length/);
    expect(() => adjustedRandIndex([], [])).toThrow(/empty/);
  });
});

describe("canonicaliseLabels", () => {
  it("renames so cluster 0 holds the lowest-indexed row", () => {
    const labels = Int32Array.from([2, 2, 0, 1, 0]);
    const permutation = canonicaliseLabels(labels, 3);
    expect([...labels]).toEqual([0, 0, 1, 2, 1]);
    expect([...permutation]).toEqual([1, 2, 0]);
  });

  it("leaves an already-canonical partition alone", () => {
    const labels = Int32Array.from([0, 0, 1, 1, 2]);
    canonicaliseLabels(labels, 3);
    expect([...labels]).toEqual([0, 0, 1, 1, 2]);
  });

  it("keeps the map a bijection when a cluster is empty", () => {
    const labels = Int32Array.from([1, 1, 1]);
    const permutation = canonicaliseLabels(labels, 3);
    expect([...labels]).toEqual([0, 0, 0]);
    expect([...permutation].slice().sort()).toEqual([0, 1, 2]);
  });
});

describe("kMeans on the two-arc ensemble (P6.21 validation)", () => {
  it("separates the bimodal ensemble into 2 clusters with ARI > 0.9", () => {
    // THE CRITERION. 80 replicates, two complementary-angle modes, labels
    // known by construction.
    const { trajectories, labels } = twoArcEnsemble(40);
    const clustering = clusterTrajectories(trajectories, 2, {
      ...SHAPE,
      gridPointCount: 32,
      observables: [TIME_OF_FLIGHT, APEX_HEIGHT],
      seed: 1n,
    });

    const ari = adjustedRandIndex(clustering.labels, labels);
    expect(ari).toBeGreaterThan(0.9);
    expect(clustering.sizes[0]! + clustering.sizes[1]!).toBe(80);
    expect(clustering.converged).toBe(true);
  });

  it("separates them on shape alone, with no observables at all", () => {
    // Guards against the criterion being met by the observables while the
    // resampled y(t) contributes nothing -- the task names both halves, and a
    // shape block that was silently useless would still pass the test above.
    const { trajectories, labels } = twoArcEnsemble(40);
    const clustering = clusterTrajectories(trajectories, 2, {
      ...SHAPE,
      gridPointCount: 32,
      seed: 1n,
    });
    expect(adjustedRandIndex(clustering.labels, labels)).toBeGreaterThan(0.9);
  });

  it("cannot separate them on range, which is why the fixture uses complementary angles", () => {
    // Range is `v² sin(2θ)/g`, symmetric about 45°, so it is equal across the
    // two modes up to the fixture's jitter. Clustering on range alone should
    // therefore score near chance. If this ever scores well, the fixture has
    // stopped testing what it claims to and the ARI result above is cheap.
    const { trajectories, labels } = twoArcEnsemble(40);
    const rangeOnly: NamedObservable = {
      name: "range",
      of: (trajectory) => (trajectory.channels[2] as Float64Array)[trajectory.nSteps - 1] as number,
    };
    const features = buildTrajectoryFeatures(trajectories, {
      ...SHAPE,
      gridPointCount: 2,
      observables: [rangeOnly],
      // Silence the shape block entirely so only `range` drives the distance.
      blockWeights: { shape: 0, observable: 1 },
    });
    const ari = adjustedRandIndex(kMeans(features, 2, { seed: 1n }).labels, labels);
    expect(ari).toBeLessThan(0.5);
  });

  it("degrades rather than saturating when the two modes overlap", () => {
    // The criterion's fixture scores a perfect 1.0, which on its own cannot
    // distinguish "the pipeline works" from "the metric always says 1". Moving
    // the modes to 40°/50° with the same jitter makes them genuinely overlap,
    // and the score should land clearly between chance and perfect.
    const rng = new PCG32(20260901n);
    const trajectories: Trajectory[] = [];
    const labels: number[] = [];
    for (let i = 0; i < 40; i++) {
      trajectories.push(arc(60 + rng.nextGaussian() * 1.5, 40 + rng.nextGaussian() * 2));
      labels.push(0);
    }
    for (let i = 0; i < 40; i++) {
      trajectories.push(arc(60 + rng.nextGaussian() * 1.5, 50 + rng.nextGaussian() * 2));
      labels.push(1);
    }
    const clustering = clusterTrajectories(trajectories, 2, {
      ...SHAPE,
      gridPointCount: 32,
      observables: [TIME_OF_FLIGHT],
      seed: 1n,
    });
    const ari = adjustedRandIndex(clustering.labels, labels);
    expect(ari).toBeGreaterThan(0.5);
    expect(ari).toBeLessThan(1);
  });

  it("reports no structure, rather than inventing it, on a single population", () => {
    // Both halves drawn from the SAME distribution and then labelled as two
    // groups. k-means still returns two clusters -- it is required to, and it
    // is why the module doc says a partition is not evidence that k
    // populations exist -- but the split must have nothing to do with the fake
    // labels. ARI near zero is exactly that statement, and it is the reason
    // the criterion is written in ARI rather than in an accuracy, which would
    // read ~0.5 here and look like a signal.
    const rng = new PCG32(7n);
    const trajectories: Trajectory[] = [];
    const labels: number[] = [];
    for (let i = 0; i < 80; i++) {
      trajectories.push(arc(60 + rng.nextGaussian() * 1.5, 45 + rng.nextGaussian() * 4));
      labels.push(i < 40 ? 0 : 1);
    }
    const clustering = clusterTrajectories(trajectories, 2, {
      ...SHAPE,
      gridPointCount: 32,
      observables: [TIME_OF_FLIGHT],
      seed: 1n,
    });
    expect(Math.abs(adjustedRandIndex(clustering.labels, labels))).toBeLessThan(0.15);
    // It did partition; it just partitioned something other than the labels.
    expect(clustering.sizes[0]).toBeGreaterThan(0);
    expect(clustering.sizes[1]).toBeGreaterThan(0);
  });

  it("is reproducible: the same seed gives bit-identical labels", () => {
    const { trajectories } = twoArcEnsemble(20);
    const options = { ...SHAPE, gridPointCount: 16, observables: [TIME_OF_FLIGHT], seed: 42n };
    const first = clusterTrajectories(trajectories, 2, options);
    const second = clusterTrajectories(trajectories, 2, options);
    expect([...second.labels]).toEqual([...first.labels]);
    expect(second.inertia).toBe(first.inertia);
    expect([...second.centroids]).toEqual([...first.centroids]);
  });

  it("returns the same partition under a different seed, thanks to canonical labels", () => {
    // Different seeding, same well-separated data: the partition must agree,
    // and canonicalisation means it agrees *by label* and not merely up to a
    // permutation. This is what P6.22's stable colours rest on.
    const { trajectories } = twoArcEnsemble(20);
    const base = { ...SHAPE, gridPointCount: 16, observables: [TIME_OF_FLIGHT] };
    const a = clusterTrajectories(trajectories, 2, { ...base, seed: 1n });
    const b = clusterTrajectories(trajectories, 2, { ...base, seed: 999n });
    expect([...b.labels]).toEqual([...a.labels]);
  });
});

describe("kMeans mechanics", () => {
  const wellSeparated = () => {
    const { trajectories } = twoArcEnsemble(6);
    return buildTrajectoryFeatures(trajectories, {
      ...SHAPE,
      gridPointCount: 8,
      observables: [TIME_OF_FLIGHT],
    });
  };

  it("returns exactly k centroids and sizes summing to the row count", () => {
    const features = wellSeparated();
    for (const k of [1, 2, 3, 5]) {
      const result = kMeans(features, k, { seed: 7n });
      expect(result.sizes).toHaveLength(k);
      expect(result.centroids).toHaveLength(k * features.dimension);
      let total = 0;
      for (const size of result.sizes) total += size;
      expect(total).toBe(features.rowCount);
    }
  });

  it("puts every row in cluster 0 when k is 1, with inertia equal to total spread", () => {
    const features = wellSeparated();
    const result = kMeans(features, 1, { seed: 7n });
    expect([...result.labels].every((label) => label === 0)).toBe(true);
    // With one centroid the inertia is by definition the total sum of squares
    // about the column means -- and standardisation already put those means at
    // zero, so it is just the sum of every squared entry. Computed from the
    // data rather than predicted from rowCount, because a closed form would
    // have to model the constant y(t=0) column and would then be asserting the
    // fixture's geometry instead of the estimator's identity.
    let totalSquares = 0;
    for (const v of features.data) totalSquares += v * v;
    expect(result.inertia).toBeCloseTo(totalSquares, 8);
  });

  it("drives inertia to zero when k equals the row count", () => {
    const features = wellSeparated();
    const result = kMeans(features, features.rowCount, { seed: 3n });
    expect(result.inertia).toBeCloseTo(0, 10);
    expect(new Set([...result.labels]).size).toBe(features.rowCount);
  });

  it("never increases inertia as k grows", () => {
    const features = wellSeparated();
    let previous = Number.POSITIVE_INFINITY;
    for (const k of [1, 2, 3, 4, 6]) {
      const inertia = kMeans(features, k, { seed: 11n, restarts: 20 }).inertia;
      // Monotone non-increasing in k is a property of the *optimum*, not of
      // every local minimum, which is why this runs with generous restarts.
      expect(inertia).toBeLessThanOrEqual(previous + 1e-9);
      previous = inertia;
    }
  });

  it("still fills k clusters when the data has fewer natural groups", () => {
    // Two tight modes, k = 4. An implementation that dropped empty clusters
    // would return fewer than 4 centroids and break a caller's colour table.
    const features = wellSeparated();
    const result = kMeans(features, 4, { seed: 5n });
    expect(result.sizes).toHaveLength(4);
    for (const size of result.sizes) expect(size).toBeGreaterThan(0);
  });

  it("rejects an out-of-range k rather than clamping it", () => {
    const features = wellSeparated();
    expect(() => kMeans(features, 0)).toThrow(/k must be/);
    expect(() => kMeans(features, features.rowCount + 1)).toThrow(/k must be/);
    expect(() => kMeans(features, 1.5)).toThrow(/k must be/);
  });

  it("rejects non-positive iteration and restart counts", () => {
    const features = wellSeparated();
    expect(() => kMeans(features, 2, { maxIterations: 0 })).toThrow(/maxIterations/);
    expect(() => kMeans(features, 2, { restarts: 0 })).toThrow(/restarts/);
  });

  it("reports converged=false rather than pretending, when capped at one iteration", () => {
    const features = wellSeparated();
    const result = kMeans(features, 3, { seed: 2n, maxIterations: 1, restarts: 1 });
    expect(result.converged).toBe(false);
    // The partition is still usable and internally consistent -- it just is
    // not a fixed point, and the flag is how a caller learns that.
    let total = 0;
    for (const size of result.sizes) total += size;
    expect(total).toBe(features.rowCount);
  });

  it("refuses a feature matrix containing a non-finite value", () => {
    const features = wellSeparated();
    const poisoned = {
      ...features,
      data: Float64Array.from(features.data, (v, i) => (i === 3 ? Number.NaN : v)),
    };
    expect(() => kMeans(poisoned, 2)).toThrow(/non-finite/);
  });
});
