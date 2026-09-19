// P7.31 guard: the trend says only what the series supports.
//
// Two halves, in two describe blocks, because either can fail while the other
// holds — the same split `wgsl-workgroup-sweep.test.ts` makes. An alert rule
// can be exactly right while the chart draws a line across a machine change;
// a chart can be perfect over a series graded by a rule that fires on n=1.
//
// The last block asserts the recorded artifact rather than the logic:
// `scripts/benchmark-history.json` is a committed JSON file and nothing stops
// a later edit from lowering a threshold, adding a sample with no machineId,
// or putting the samples out of date order. These make that fail.
//
// If a threshold assertion here is failing, the fix is to re-measure the noise
// table in `benchmark-trend.ts`'s header and move both knobs together. It is
// not to relax the assertion — the whole point of the table is that a
// threshold below the metric's noise floor is a false-alarm generator, which
// is what `scripts/benchmark-baseline.json`'s 15% currently is.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_TREND_THRESHOLDS,
  machineSegments,
  median,
  renderBenchmarkTrendSvg,
  summariseBenchmarkTrend,
  type BenchmarkTrendHistory,
  type BenchmarkTrendSample,
} from "./benchmark-trend.js";

const repoRoot = new URL("../../../", import.meta.url);

const THRESHOLDS = { regressionPct: 20, minSamples: 3 } as const;

function sample(
  machineId: string,
  ratios: Record<string, number>,
  recordedAt = "2026-01-01",
): BenchmarkTrendSample {
  return { recordedAt, machineId, ratios };
}

function history(samples: readonly BenchmarkTrendSample[]): BenchmarkTrendHistory {
  return { schemaVersion: 1, metric: "test metric", alert: THRESHOLDS, samples };
}

/** A flat series on one machine, long enough to clear `minSamples`. */
function flatSeries(value: number, count: number, machineId = "m1"): BenchmarkTrendSample[] {
  return Array.from({ length: count }, () => sample(machineId, { a: value }));
}

describe("median", () => {
  it("averages the middle two on an even count", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("does not mutate its input", () => {
    const values = [3, 1, 2];
    median(values);
    expect(values).toEqual([3, 1, 2]);
  });

  it("refuses an empty list rather than returning a number", () => {
    expect(() => median([])).toThrow(RangeError);
  });

  it("is unmoved by one outlier, which is why it is the reference", () => {
    expect(median([1, 1, 1, 1, 100])).toBe(1);
  });
});

describe("machineSegments", () => {
  it("splits at each change and keeps order", () => {
    const segments = machineSegments([
      sample("a", { x: 1 }),
      sample("a", { x: 1 }),
      sample("b", { x: 1 }),
    ]);
    expect(segments.map((s) => s.length)).toEqual([2, 1]);
    expect(segments[1]?.[0]?.machineId).toBe("b");
  });

  it("starts a new segment when a machine recurs after an excursion", () => {
    // Deliberate: re-joining "a" across the gap would draw exactly the line
    // across a discontinuity this module refuses to draw.
    const segments = machineSegments([
      sample("a", { x: 1 }),
      sample("b", { x: 1 }),
      sample("a", { x: 1 }),
    ]);
    expect(segments.map((s) => s[0]?.machineId)).toEqual(["a", "b", "a"]);
  });

  it("returns nothing for an empty series", () => {
    expect(machineSegments([])).toEqual([]);
  });
});

describe("summariseBenchmarkTrend", () => {
  it("refuses an empty history instead of reporting an all-clear", () => {
    expect(() => summariseBenchmarkTrend(history([]))).toThrow(RangeError);
  });

  it("will not alert below minSamples, however far the latest point fell", () => {
    // The failure this whole module exists to prevent: a median of one point is
    // that point, so alerting there is the single-snapshot comparison wearing a
    // different name.
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 2), sample("m1", { a: 0.1 })]),
      THRESHOLDS,
    );
    expect(summary.methods[0]?.verdict).toBe("insufficient-history");
    expect(summary.alerts).toEqual([]);
  });

  it("alerts once the history is long enough and the fall clears the threshold", () => {
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), sample("m1", { a: 0.5 })]),
      THRESHOLDS,
    );
    expect(summary.methods[0]?.verdict).toBe("regressed");
    expect(summary.methods[0]?.changePct).toBeCloseTo(-50, 6);
    expect(summary.alerts.map((a) => a.id)).toEqual(["a"]);
  });

  it("does not alert on a fall exactly at the threshold, only beyond it", () => {
    const atThreshold = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), sample("m1", { a: 0.8 })]),
      THRESHOLDS,
    );
    expect(atThreshold.methods[0]?.verdict).toBe("ok");
    const beyond = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), sample("m1", { a: 0.79 })]),
      THRESHOLDS,
    );
    expect(beyond.methods[0]?.verdict).toBe("regressed");
  });

  it("never alerts on an improvement, however large", () => {
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), sample("m1", { a: 100 })]),
      THRESHOLDS,
    );
    expect(summary.methods[0]?.verdict).toBe("ok");
    expect(summary.alerts).toEqual([]);
  });

  it("ignores samples from other machines when building the reference", () => {
    // The three "m0" points are a long, flat, tempting history. They are not
    // this machine's, so the latest point has nothing to be compared against.
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 3, "m0"), sample("m1", { a: 0.1 })]),
      THRESHOLDS,
    );
    expect(summary.machineId).toBe("m1");
    expect(summary.machineSamples).toBe(1);
    expect(summary.methods[0]?.verdict).toBe("insufficient-history");
    expect(summary.methods[0]?.reference).toBeNull();
  });

  it("counts only same-machine samples in machineSamples", () => {
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 2, "m0"), ...flatSeries(1, 3, "m1")]),
      THRESHOLDS,
    );
    expect(summary.machineSamples).toBe(3);
  });

  it("calls a method new rather than regressed on its first appearance", () => {
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), { ...sample("m1", { a: 1, b: 0.01 }) }]),
      THRESHOLDS,
    );
    const b = summary.methods.find((m) => m.id === "b");
    expect(b?.verdict).toBe("new-method");
    expect(summary.alerts).toEqual([]);
  });

  it("grades only the methods present in the latest sample", () => {
    const summary = summariseBenchmarkTrend(
      history([sample("m1", { a: 1, gone: 1 }), ...flatSeries(1, 2), sample("m1", { a: 1 })]),
      THRESHOLDS,
    );
    expect(summary.methods.map((m) => m.id)).toEqual(["a"]);
  });

  it("uses the history's own alert block when no thresholds are passed", () => {
    const strict = { schemaVersion: 1, metric: "m", alert: { regressionPct: 1, minSamples: 1 } };
    const summary = summariseBenchmarkTrend({
      ...strict,
      samples: [...flatSeries(1, 1), sample("m1", { a: 0.9 })],
    });
    expect(summary.thresholds.regressionPct).toBe(1);
    expect(summary.methods[0]?.verdict).toBe("regressed");
  });

  it("sorts rows by id so a report is stable across runs", () => {
    const summary = summariseBenchmarkTrend(
      history([...flatSeries(1, 3), sample("m1", { z: 1, a: 1, m: 1 })]),
      THRESHOLDS,
    );
    expect(summary.methods.map((m) => m.id)).toEqual(["a", "m", "z"]);
  });
});

/** Points held by each `<polyline>`, in document order. */
function polylinePointCounts(svg: string): number[] {
  return [...svg.matchAll(/<polyline[^>]*points="([^"]*)"/g)].map(
    (match) => match[1]!.trim().split(/\s+/).length,
  );
}

describe("renderBenchmarkTrendSvg", () => {
  it("refuses an empty history", () => {
    expect(() => renderBenchmarkTrendSvg(history([]))).toThrow(RangeError);
  });

  it("emits one polyline per method for a single-machine series", () => {
    const svg = renderBenchmarkTrendSvg(history(flatSeries(0.5, 3)));
    expect(svg.match(/<polyline/g)).toHaveLength(1);
    expect(svg.startsWith("<svg")).toBe(true);
  });

  it("breaks the polyline at a machine change rather than drawing across it", () => {
    // The assertion that makes the chart a claim rather than a decoration.
    //
    // ITS FIRST DRAFT COUNTED POLYLINES AND ASSERTED ALMOST NOTHING: three
    // points on one machine give one polyline, and the same three split 2/1
    // ALSO give one, so the count is identical whether the break happens or
    // not. A control that drew every series as a single segment left it green.
    // What separates the two cases is how many points that one polyline holds.
    const together = renderBenchmarkTrendSvg(history(flatSeries(0.5, 3, "m1")));
    const split = renderBenchmarkTrendSvg(
      history([...flatSeries(0.5, 2, "m1"), sample("m2", { a: 0.5 })]),
    );
    expect(polylinePointCounts(together)).toEqual([3]);
    expect(polylinePointCounts(split)).toEqual([2]);
    expect(split).toContain("machine change");
    expect(together).not.toContain("machine change");
    // Every point still gets a marker, so the lone point is visible as data.
    expect(split.match(/<circle/g)).toHaveLength(3);
  });

  it("draws no polyline at all when every segment holds one point", () => {
    const svg = renderBenchmarkTrendSvg(
      history([sample("m1", { a: 0.5 }), sample("m2", { a: 0.5 })]),
    );
    expect(svg.match(/<polyline/g)).toBeNull();
    expect(svg.match(/<circle/g)).toHaveLength(2);
  });

  it("skips a method in the segments that do not carry it, without shifting the rest", () => {
    const svg = renderBenchmarkTrendSvg(
      history([sample("m1", { a: 0.5 }), sample("m1", { a: 0.5, b: 0.25 })]),
    );
    expect(svg).toContain(">b<");
    expect(svg.match(/<circle/g)).toHaveLength(3);
  });

  it("clamps a ratio outside [0,1] into the plot rather than drawing off-canvas", () => {
    const svg = renderBenchmarkTrendSvg(history([sample("m1", { a: 5 }), sample("m1", { a: -5 })]));
    const ys = [...svg.matchAll(/<circle cx="[\d.]+" cy="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(40);
    expect(Math.max(...ys)).toBeLessThanOrEqual(404);
  });

  it("escapes markup in a metric name instead of emitting it", () => {
    const svg = renderBenchmarkTrendSvg({
      ...history(flatSeries(0.5, 2)),
      metric: '<script>&"',
    });
    expect(svg).toContain("&lt;script&gt;&amp;&quot;");
    expect(svg).not.toContain("<script>");
  });

  it("states the alert rule on the chart, so the artifact carries its own thresholds", () => {
    const svg = renderBenchmarkTrendSvg(history(flatSeries(0.5, 2)));
    expect(svg).toContain(`${THRESHOLDS.regressionPct}%`);
    expect(svg).toContain(`minimum ${THRESHOLDS.minSamples}`);
  });
});

describe("the recorded history artifact", () => {
  const recorded = JSON.parse(
    readFileSync(fileURLToPath(new URL("scripts/benchmark-history.json", repoRoot)), "utf8"),
  ) as BenchmarkTrendHistory;

  it("ships the thresholds the module's measured table supports", () => {
    expect(recorded.alert).toEqual(DEFAULT_TREND_THRESHOLDS);
  });

  it("keeps regressionPct above the worst noise excursion this repo has measured", () => {
    // -26.8% at two reference samples; see benchmark-trend.ts's header table.
    // A threshold below this is a false-alarm generator, which is precisely
    // what scripts/benchmark-baseline.json's 15% is.
    expect(recorded.alert.regressionPct).toBeGreaterThan(26.8);
  });

  it("gives every sample a machineId and a ratio for the reference method", () => {
    expect(recorded.samples.length).toBeGreaterThan(0);
    for (const s of recorded.samples) {
      expect(s.machineId).toMatch(/\S/);
      expect(s.ratios["explicit-euler"]).toBe(1);
    }
  });

  it("is in non-decreasing date order, so position means time", () => {
    const dates = recorded.samples.map((s) => s.recordedAt);
    expect([...dates].sort()).toEqual(dates);
  });

  it("summarises and charts without throwing", () => {
    const summary = summariseBenchmarkTrend(recorded);
    expect(summary.methods.length).toBeGreaterThan(0);
    expect(renderBenchmarkTrendSvg(recorded)).toContain("<svg");
  });

  it("keeps the July baseline on a machine of its own, so it is never a reference", () => {
    // Its ratios disagree with this container's by nearly a factor of two, which
    // is the measurement that put machineId in the schema at all.
    const first = recorded.samples[0]!;
    expect(first.machineId).not.toBe(recorded.samples[recorded.samples.length - 1]!.machineId);
  });
});
