import { describe, it, expect } from "vitest";
import { PCG32 } from "@ballista/engine";
import {
  buildCommonSupportGrid,
  canonicaliseLabels,
  clusterTrajectories,
  type NamedObservable,
} from "@ballista/analysis";
import type { Trajectory } from "@ballista/solverkit";
import {
  buildClusterLegend,
  buildClusterMedians,
  buildMembershipColors,
  CLUSTER_PALETTE,
  clusterColor,
  MAX_CLUSTERS,
} from "./cluster-overlay.js";

const G = 9.81;

/**
 * A drag-free ballistic arc, recorded launch to impact -- the same fixture
 * shape `trajectory-clustering.test.ts` uses, so the two suites are testing
 * the same object. Channel 0 is `y`, channel 1 is `vy = dy/dt` (so
 * resampling gets cubic Hermite rather than the linear fallback), channels 2
 * and 3 are `x` and `vx`.
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

/**
 * The bimodal ensemble P6.21's criterion is stated against: 30° and 60°
 * launches, complementary so that range alone cannot separate them, with
 * seeded jitter so each mode has real spread.
 */
function twoArcEnsemble(perMode = 40, seed = 20260901n): readonly Trajectory[] {
  const rng = new PCG32(seed);
  const out: Trajectory[] = [];
  for (const degrees of [30, 60]) {
    for (let i = 0; i < perMode; i++) {
      out.push(arc(60 + rng.nextGaussian() * 1.5, degrees + rng.nextGaussian() * 2));
    }
  }
  return out;
}

const RESAMPLE = { valueChannel: 0, derivativeChannel: 1 } as const;
const CLUSTER_OPTIONS = {
  valueChannel: 0,
  derivativeChannel: 1,
  observables: [TIME_OF_FLIGHT],
  seed: 424242n,
} as const;

function clusterTwoArcs(trajectories: readonly Trajectory[], seed = 424242n) {
  const grid = buildCommonSupportGrid(trajectories, 32);
  return clusterTrajectories(trajectories, 2, { ...CLUSTER_OPTIONS, grid, seed });
}

describe("clusterColor", () => {
  it("gives every cluster of a partition a distinct palette entry", () => {
    const colors = [0, 1, 2, 3].map((c) => clusterColor(c, 4));
    expect(new Set(colors).size).toBe(4);
    expect(colors).toEqual(CLUSTER_PALETTE.slice(0, 4));
  });

  it("refuses more clusters than the categorical palette holds, rather than cycling", () => {
    expect(() => clusterColor(0, MAX_CLUSTERS + 1)).toThrow(RangeError);
    // The message has to say why, because "cannot colour 9 clusters" alone
    // reads as an arbitrary cap rather than a deliberate refusal.
    expect(() => clusterColor(0, MAX_CLUSTERS + 1)).toThrow(/indistinguishable/);
    expect(() => clusterColor(0, MAX_CLUSTERS)).not.toThrow();
  });

  it("rejects a cluster index outside the partition instead of wrapping it", () => {
    expect(() => clusterColor(2, 2)).toThrow(RangeError);
    expect(() => clusterColor(-1, 2)).toThrow(RangeError);
    expect(() => clusterColor(1.5, 3)).toThrow(RangeError);
  });
});

describe("buildClusterLegend (P6.22 criterion: legend/count per cluster)", () => {
  it("emits one row per cluster whose counts are the cluster sizes and sum to the ensemble", () => {
    const trajectories = twoArcEnsemble();
    const clustering = clusterTwoArcs(trajectories);
    const legend = buildClusterLegend(clustering);

    expect(legend).toHaveLength(2);
    expect(legend.map((e) => e.cluster)).toEqual([0, 1]);
    expect(legend.map((e) => e.size)).toEqual([...clustering.sizes]);
    expect(legend.reduce((sum, e) => sum + e.size, 0)).toBe(trajectories.length);
    expect(legend.reduce((sum, e) => sum + e.fraction, 0)).toBeCloseTo(1, 12);
    expect(new Set(legend.map((e) => e.color)).size).toBe(2);
  });

  it("recovers the 40/40 split the labeled fixture was built with", () => {
    const legend = buildClusterLegend(clusterTwoArcs(twoArcEnsemble(40)));
    expect([...legend].map((e) => e.size).sort((a, b) => a - b)).toEqual([40, 40]);
  });

  it("names clusters one-based by default, because a legend is read by people", () => {
    const legend = buildClusterLegend(clusterTwoArcs(twoArcEnsemble(6)));
    expect(legend.map((e) => e.label)).toEqual(["Cluster 1", "Cluster 2"]);
  });

  it("lets a caller supply domain names, which this module cannot know", () => {
    const legend = buildClusterLegend(clusterTwoArcs(twoArcEnsemble(6)), {
      labelFor: (c) => ["flat arc", "steep arc"][c] as string,
    });
    expect(legend.map((e) => e.label)).toEqual(["flat arc", "steep arc"]);
  });

  it("keeps an empty cluster's row rather than renumbering the ones after it", () => {
    // Hand-built rather than coaxed out of k-means: the point is the contract,
    // and dropping the row would silently shift cluster 2's colour onto 1.
    const legend = buildClusterLegend({ sizes: Int32Array.from([3, 0, 5]) });

    expect(legend).toHaveLength(3);
    expect(legend.map((e) => e.size)).toEqual([3, 0, 5]);
    expect(legend[1]?.fraction).toBe(0);
    expect(legend[2]?.color).toBe(clusterColor(2, 3));
    expect(legend[2]?.color).not.toBe(clusterColor(1, 3));
  });

  it("refuses a clustering with no members at all", () => {
    expect(() => buildClusterLegend({ sizes: Int32Array.from([0, 0]) })).toThrow(RangeError);
    expect(() => buildClusterLegend({ sizes: new Int32Array(0) })).toThrow(RangeError);
  });
});

describe("buildMembershipColors (P6.22 criterion: membership coloring)", () => {
  it("returns one colour per replicate, matching that replicate's legend swatch", () => {
    const trajectories = twoArcEnsemble(10);
    const clustering = clusterTwoArcs(trajectories);
    const legend = buildClusterLegend(clustering);
    const colors = buildMembershipColors(clustering.labels, clustering.sizes.length);

    expect(colors).toHaveLength(trajectories.length);
    for (let i = 0; i < colors.length; i++) {
      expect(colors[i]).toBe(legend[clustering.labels[i] as number]?.color);
    }
  });

  it("rejects a label outside the partition instead of colouring it anyway", () => {
    // This means the caller paired a labelling with the wrong k; clamping it
    // would hide a real bug behind a plausible-looking chart.
    expect(() => buildMembershipColors(Int32Array.from([0, 1, 2]), 2)).toThrow(RangeError);
    expect(() => buildMembershipColors(Int32Array.from([0, -1]), 2)).toThrow(RangeError);
  });
});

describe("stable colors across reruns (P6.22 criterion, seeded)", () => {
  it("assigns every replicate the same colour when the same seeded clustering is run twice", () => {
    const trajectories = twoArcEnsemble(30);
    const first = clusterTwoArcs(trajectories, 99n);
    const second = clusterTwoArcs(trajectories, 99n);

    const firstColors = buildMembershipColors(first.labels, first.sizes.length);
    const secondColors = buildMembershipColors(second.labels, second.sizes.length);

    expect(secondColors).toEqual(firstColors);
    expect(buildClusterLegend(second)).toEqual(buildClusterLegend(first));
  });

  it("holds across *different* seeds too, when both find the same partition", () => {
    // The stronger statement, and the one a user actually cares about: re-running
    // the study should not repaint the chart. It holds here because the two-arc
    // fixture is separable enough that both seeds converge on the same answer --
    // which is a property of the fixture, not a guarantee of k-means, so the
    // assertion is written to check the premise before the conclusion.
    const trajectories = twoArcEnsemble(30);
    const a = clusterTwoArcs(trajectories, 7n);
    const b = clusterTwoArcs(trajectories, 123456789n);

    expect([...b.labels]).toEqual([...a.labels]);
    expect(buildMembershipColors(b.labels, 2)).toEqual(buildMembershipColors(a.labels, 2));
  });

  it("is inherited from canonicalised labels, and visibly breaks without them", () => {
    // The caveat the module documents, asserted rather than left in prose:
    // this module cannot create colour stability, it can only preserve it.
    const trajectories = twoArcEnsemble(8);
    const clustering = clusterTwoArcs(trajectories);

    // Same partition, names swapped -- exactly what an uncanonicalised k-means
    // run is free to return.
    const swapped = Int32Array.from(clustering.labels, (l) => 1 - l);
    expect(buildMembershipColors(swapped, 2)).not.toEqual(
      buildMembershipColors(clustering.labels, 2),
    );

    // And canonicalising puts it back, which is what kMeans already does.
    // Note the in-place contract: canonicaliseLabels rewrites `swapped` and
    // returns the old-to-new permutation, not the relabelled array.
    const permutation = canonicaliseLabels(swapped, 2);
    expect([...permutation]).toEqual([1, 0]);
    expect(buildMembershipColors(swapped, 2)).toEqual(buildMembershipColors(clustering.labels, 2));
  });
});

describe("buildClusterMedians (per-cluster median trajectory)", () => {
  it("returns one curve per cluster on the shared grid, coloured to match the legend", () => {
    const trajectories = twoArcEnsemble(20);
    const clustering = clusterTwoArcs(trajectories);
    const grid = buildCommonSupportGrid(trajectories, 24);
    const medians = buildClusterMedians(trajectories, clustering, grid, RESAMPLE);
    const legend = buildClusterLegend(clustering);

    expect(medians).toHaveLength(2);
    for (let c = 0; c < 2; c++) {
      expect(medians[c]?.cluster).toBe(c);
      expect(medians[c]?.color).toBe(legend[c]?.color);
      expect(medians[c]?.size).toBe(legend[c]?.size);
      expect([...(medians[c]?.grid ?? [])]).toEqual([...grid]);
      expect(medians[c]?.median).toHaveLength(grid.length);
    }
  });

  it("separates the two modes: the steep cluster's median is the higher curve", () => {
    // The visualisation's whole job. Apex height goes as sin^2(theta), so the
    // 60 deg mode peaks about (sin60/sin30)^2 = 3x higher than the 30 deg one.
    const trajectories = twoArcEnsemble(20);
    const clustering = clusterTwoArcs(trajectories);
    const grid = buildCommonSupportGrid(trajectories, 24);
    const medians = buildClusterMedians(trajectories, clustering, grid, RESAMPLE);

    const peaks = medians.map((m) =>
      [...m.median].reduce((best, v) => (Number.isFinite(v) ? Math.max(best, v) : best), -Infinity),
    );
    const ratio = Math.max(...peaks) / Math.min(...peaks);
    expect(ratio).toBeGreaterThan(2.5);
    expect(ratio).toBeLessThan(3.5);
  });

  it("reports commonSupportEnd per cluster, because the modes stop at different times", () => {
    // The module's main honesty commitment. The two modes' times of flight
    // differ by sin60/sin30 = 1.73, so one median is NaN over a stretch where
    // the other is still a real curve. A single ensemble-wide number would
    // hide that, and a chart trusting it would draw a line through empty air.
    const trajectories = twoArcEnsemble(20);
    const clustering = clusterTwoArcs(trajectories);
    // Deliberately the *union* grid, which runs past the short mode's impact.
    const longest = Math.max(...trajectories.map((t) => t.t[t.nSteps - 1] as number));
    const grid = Float64Array.from({ length: 40 }, (_, i) => (longest * i) / 39);
    const medians = buildClusterMedians(trajectories, clustering, grid, RESAMPLE);

    const ends = medians.map((m) => m.commonSupportEnd);
    expect(ends.every(Number.isFinite)).toBe(true);
    expect(Math.max(...ends)).toBeGreaterThan(Math.min(...ends) * 1.4);

    const shortCluster = medians[ends[0] === Math.min(...ends) ? 0 : 1];
    const longCluster = medians[ends[0] === Math.min(...ends) ? 1 : 0];
    const last = grid.length - 1;
    expect(Number.isFinite(shortCluster?.median[last] as number)).toBe(false);
    expect(shortCluster?.sampleCount[last]).toBe(0);
    expect(Number.isFinite(longCluster?.median[last] as number)).toBe(true);
  });

  it("reproduces a lone member exactly, since a one-element median is that element", () => {
    // Pins the median to the resampling path rather than to a private
    // implementation: whatever buildEnsembleFan would draw for this replicate
    // is what a singleton cluster draws.
    const single = arc(50, 45);
    const grid = buildCommonSupportGrid([single], 16);
    const medians = buildClusterMedians(
      [single],
      { labels: Int32Array.from([0]), sizes: Int32Array.from([1]) },
      grid,
      RESAMPLE,
    );

    const theta = Math.PI / 4;
    const vy0 = 50 * Math.sin(theta);
    for (let i = 0; i < grid.length; i++) {
      const t = grid[i] as number;
      expect(medians[0]?.median[i]).toBeCloseTo(vy0 * t - 0.5 * G * t * t, 6);
    }
  });

  it("gives an empty cluster an all-NaN curve rather than dropping its row", () => {
    const single = arc(50, 45);
    const grid = buildCommonSupportGrid([single], 8);
    const medians = buildClusterMedians(
      [single],
      { labels: Int32Array.from([0]), sizes: Int32Array.from([1, 0]) },
      grid,
      RESAMPLE,
    );

    expect(medians).toHaveLength(2);
    expect(medians[1]?.size).toBe(0);
    expect([...(medians[1]?.median ?? [])].every(Number.isNaN)).toBe(true);
    expect([...(medians[1]?.sampleCount ?? [])].every((n) => n === 0)).toBe(true);
    expect(medians[1]?.commonSupportEnd).toBeNaN();
    expect(medians[1]?.color).toBe(clusterColor(1, 2));
  });

  it("refuses a labelling that does not match the ensemble it is supposed to label", () => {
    const trajectories = [arc(50, 30), arc(50, 60)];
    const grid = buildCommonSupportGrid(trajectories, 8);
    expect(() =>
      buildClusterMedians(
        trajectories,
        { labels: Int32Array.from([0]), sizes: Int32Array.from([1]) },
        grid,
        RESAMPLE,
      ),
    ).toThrow(RangeError);
    expect(() =>
      buildClusterMedians(
        trajectories,
        { labels: Int32Array.from([0, 2]), sizes: Int32Array.from([1, 1]) },
        grid,
        RESAMPLE,
      ),
    ).toThrow(RangeError);
  });
});
