import { describe, expect, it } from "vitest";
import type { EnsembleFan } from "@ballista/analysis";
import type { McDashboardProgress, McDashboardResult } from "@ballista/runtime";
import {
  clampMcReplicates,
  fanGeometry,
  formatHitEstimate,
  formatRangeEstimate,
  histogramBarGeometry,
  initialMcPageState,
  isMcStudyRunning,
  MC_REPLICATE_CHOICES,
  mcPageReducer,
  mcProgressFraction,
  rangeHistogram,
  summarizeMcStudy,
  type McPageState,
} from "./monte-carlo-page-logic.js";

function progress(overrides: Partial<McDashboardProgress> = {}): McDashboardProgress {
  return { stage: "ensemble", completed: 5, total: 20, ...overrides };
}

/**
 * A study result assembled by hand, so the logic tests never integrate
 * anything. Six replicates, four of which landed.
 */
function result(overrides: Partial<McDashboardResult> = {}): McDashboardResult {
  const range = Float64Array.from([100, 110, 120, 130, 999, 998]);
  const landed = Uint8Array.from([1, 1, 1, 1, 0, 0]);
  return {
    columns: {
      range,
      apexHeight: Float64Array.from([10, 11, 12, 13, 90, 91]),
      timeOfFlight: Float64Array.from([2, 2.1, 2.2, 2.3, 60, 60]),
      impactSpeed: Float64Array.from([30, 31, 32, 33, 0, 0]),
      landed,
    },
    stats: {
      count: 6,
      landedCount: 4,
      range: { sum: 460, sumSquares: 53000, min: 100, max: 130, mean: 115, variance: 500 / 3 },
      apexHeight: { sum: 46, sumSquares: 534, min: 10, max: 13, mean: 11.5, variance: 5 / 3 },
      timeOfFlight: { sum: 8.6, sumSquares: 18.54, min: 2, max: 2.3, mean: 2.15, variance: 0.0167 },
      impactSpeed: { sum: 126, sumSquares: 3974, min: 30, max: 33, mean: 31.5, variance: 5 / 3 },
    },
    hit: {
      successes: 3,
      trials: 4,
      hits: 3,
      shots: 4,
      pHat: 0.75,
      center: 0.7,
      lower: 0.3,
      upper: 0.95,
      level: 0.95,
    },
    unlandedCount: 2,
    fan: FAN,
    fanReplicates: 3,
    cost: { ensemble: 6, fan: 3, total: 9 },
    ...overrides,
  } as McDashboardResult;
}

/** Three grid points, three levels, with a deliberate NaN tail on the top band. */
const FAN: EnsembleFan = {
  grid: Float64Array.from([0, 1, 2]),
  levels: [0.05, 0.5, 0.95],
  bands: [
    Float64Array.from([0, 5, 0]),
    Float64Array.from([0, 10, 0]),
    Float64Array.from([0, 20, Number.NaN]),
  ],
  sampleCount: Int32Array.from([3, 3, 2]),
  replicateCount: 3,
  commonSupportEnd: 1,
};

describe("P6.24 the dashboard state machine", () => {
  it("starts idle and says so rather than showing an empty chart", () => {
    expect(initialMcPageState.status).toBe("idle");
    expect(summarizeMcStudy(initialMcPageState)).toBe("No study run yet.");
    expect(isMcStudyRunning(initialMcPageState)).toBe(false);
  });

  it("names the stage while a study is in flight, because the two cost the same", () => {
    const running = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "progress",
      progress: progress({ stage: "fan", completed: 7, total: 9 }),
    });
    expect(summarizeMcStudy(running)).toBe("recording trajectories: 7 / 9 replicates");
  });

  it("keeps the previous result through a cancel, and labels it with its own N", () => {
    // The choice sensitivityStudyReducer and basinReducer both make: a
    // completed study is a true description of the ensemble it ran on, and a
    // later abandoned run is no reason to blank it.
    const ready = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "ready",
      result: result(),
      replicates: 256,
    });
    const cancelled = mcPageReducer(mcPageReducer(ready, { type: "start" }), {
      type: "cancelled",
    });
    expect(cancelled.result).toBe(ready.result);
    expect(cancelled.resultReplicates).toBe(256);
    expect(summarizeMcStudy(cancelled)).toBe("Cancelled. Showing the previous study at N = 256.");
  });

  it("says so plainly when a cancel came before any result", () => {
    const cancelled = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "cancelled",
    });
    expect(summarizeMcStudy(cancelled)).toBe("Cancelled before any result.");
  });

  it("drops a progress report that arrives after the cancel", () => {
    // The study is synchronous but the cancel races whatever the host already
    // queued; a bar that keeps filling after the user stopped it is a lie.
    const cancelled = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "cancelled",
    });
    const late = mcPageReducer(cancelled, { type: "progress", progress: progress() });
    expect(late).toBe(cancelled);
  });

  it("drops a result that arrives after the cancel", () => {
    const cancelled = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "cancelled",
    });
    const late = mcPageReducer(cancelled, { type: "ready", result: result(), replicates: 128 });
    expect(late).toBe(cancelled);
  });

  it("surfaces a failure's message rather than a bare status", () => {
    const failed = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "failed",
      error: "worker died",
    });
    expect(summarizeMcStudy(failed)).toBe("Study failed: worker died");
  });

  it("clears a previous error when a new run starts", () => {
    // exactOptionalPropertyTypes is on, so "absent" and "present and
    // undefined" are different; the reducer rebuilds rather than spreads.
    const failed = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "failed",
      error: "worker died",
    });
    const restarted = mcPageReducer(failed, { type: "start" });
    expect("error" in restarted).toBe(false);
    expect("progress" in restarted).toBe(false);
  });
});

describe("P6.24 progress fraction distinguishes 'not started' from 'zero done'", () => {
  it("is undefined before the first report, so the bar renders indeterminate", () => {
    const running = mcPageReducer(initialMcPageState, { type: "start" });
    expect(mcProgressFraction(running)).toBeUndefined();
  });

  it("is the completed share once reports arrive", () => {
    const running = mcPageReducer(mcPageReducer(initialMcPageState, { type: "start" }), {
      type: "progress",
      progress: progress({ completed: 5, total: 20 }),
    });
    expect(mcProgressFraction(running)).toBe(0.25);
  });

  it("is undefined once the study is no longer running", () => {
    const ready: McPageState = { status: "ready", progress: progress(), result: result() };
    expect(mcProgressFraction(ready)).toBeUndefined();
  });
});

describe("P6.24 the replicate control rounds down", () => {
  it("snaps onto the offered values", () => {
    expect(clampMcReplicates(700)).toBe(512);
    expect(clampMcReplicates(512)).toBe(512);
  });

  it("clamps at both ends and refuses a non-finite request", () => {
    expect(clampMcReplicates(1)).toBe(MC_REPLICATE_CHOICES[0]);
    expect(clampMcReplicates(1e9)).toBe(MC_REPLICATE_CHOICES.at(-1));
    expect(clampMcReplicates(Number.NaN)).toBe(MC_REPLICATE_CHOICES[0]);
  });

  it("never rounds up, because the cost is linear in N", () => {
    for (const requested of [129, 300, 1023, 2047]) {
      expect(clampMcReplicates(requested)).toBeLessThanOrEqual(requested);
    }
  });
});

describe("P6.24 the histogram bins only what landed", () => {
  it("excludes the replicates that ran out of horizon", () => {
    // The two unlanded replicates sit at 998 and 999 m -- an order of
    // magnitude beyond the landed ones. If the mask were dropped the domain
    // would stretch to include them and the four real values would collapse
    // into a single left-hand bin.
    const histogram = rangeHistogram(result(), 4);
    expect(histogram.total).toBe(4);
    expect(histogram.excluded).toBe(2);
    expect(histogram.binEdges[0]).toBe(100);
    expect(histogram.binEdges[histogram.binEdges.length - 1]).toBe(130);
  });

  it("bars are fractions of the tallest bin, with the counts kept alongside", () => {
    const bars = histogramBarGeometry(rangeHistogram(result(), 3));
    expect(bars.reduce((sum, bar) => sum + bar.count, 0)).toBe(4);
    expect(Math.max(...bars.map((bar) => bar.fraction))).toBe(1);
    for (const bar of bars) {
      expect(bar.fraction).toBeGreaterThanOrEqual(0);
      expect(bar.fraction).toBeLessThanOrEqual(1);
      expect(bar.to).toBeGreaterThan(bar.from);
    }
  });

  it("an all-empty histogram gives zero heights rather than NaN", () => {
    const empty = histogramBarGeometry({
      binEdges: Float64Array.from([0, 1, 2]),
      counts: Uint32Array.from([0, 0]),
      total: 0,
      belowDomain: 0,
      aboveDomain: 0,
      excluded: 5,
    });
    expect(empty.map((bar) => bar.fraction)).toEqual([0, 0]);
  });
});

describe("P6.24 the fan projects into a unit box with y flipped for SVG", () => {
  it("maps the tallest sample to y = 0 and the lowest to y = 1", () => {
    const geometry = fanGeometry(FAN);
    expect(geometry.yMin).toBe(0);
    expect(geometry.yMax).toBe(20);
    // The 0.95 band peaks at 20 -- the ensemble maximum -- so its middle point
    // sits at the top of the box.
    expect(geometry.bands[2]?.points).toContain("0.500000,0.000000");
    // The 0.05 band starts at 0 -- the minimum -- so it sits at the bottom.
    expect(geometry.bands[0]?.points.startsWith("0.000000,1.000000")).toBe(true);
  });

  it("omits NaN samples rather than interpolating across them", () => {
    // The 0.95 band's last sample is NaN: past that grid time no replicate in
    // the top decile is still in flight. Joining the previous point to the
    // next real one would draw a chord through empty air.
    const geometry = fanGeometry(FAN);
    expect(geometry.bands[2]?.points.split(" ")).toHaveLength(2);
    expect(geometry.bands[1]?.points.split(" ")).toHaveLength(3);
  });

  it("reports where the common support ends, projected into the same box", () => {
    const geometry = fanGeometry(FAN);
    // commonSupportEnd is 1 on a grid spanning [0, 2], so it is halfway.
    expect(geometry.commonSupportX).toBeCloseTo(0.5, 12);
  });

  it("reports no common-support mark when no grid point has every replicate", () => {
    const geometry = fanGeometry({ ...FAN, commonSupportEnd: Number.NaN });
    expect(geometry.commonSupportX).toBeUndefined();
  });

  it("a flat ensemble maps to the middle rather than dividing by zero", () => {
    const flat: EnsembleFan = {
      ...FAN,
      bands: [Float64Array.from([7, 7, 7])],
      levels: [0.5],
    };
    const geometry = fanGeometry(flat);
    expect(geometry.bands[0]?.points).toBe("0.000000,0.500000 0.500000,0.500000 1.000000,0.500000");
  });
});

describe("P6.24 every number carries its sample size", () => {
  it("the range estimate is a t interval over the landed subset, with n", () => {
    const text = formatRangeEstimate(result());
    expect(text).toContain("115.00");
    expect(text).toContain("n = 4");
    expect(text).toContain("95% CI");
    expect(text).toContain("m ");
  });

  it("refuses an interval it cannot form, in words rather than as a blank", () => {
    const single = result({
      columns: {
        range: Float64Array.from([100, 200]),
        apexHeight: Float64Array.from([1, 2]),
        timeOfFlight: Float64Array.from([1, 2]),
        impactSpeed: Float64Array.from([1, 2]),
        landed: Uint8Array.from([1, 0]),
      },
    });
    expect(formatRangeEstimate(single)).toBe("1 landed replicate(s) — too few for an interval");
  });

  it("the hit estimate carries its Wilson interval and its n", () => {
    const text = formatHitEstimate(result());
    expect(text).toContain("75.0%");
    expect(text).toContain("(3/4)");
  });

  it("and says out loud when it is conditional on landing", () => {
    expect(formatHitEstimate(result())).toContain("conditional on landing");
    expect(formatHitEstimate(result())).toContain("2 replicate(s) did not land");
  });

  it("but does not add that caveat when every replicate landed", () => {
    // The caveat is information; repeating it where it does not apply would
    // train a reader to ignore it.
    const allLanded = result({ unlandedCount: 0 });
    expect(formatHitEstimate(allLanded)).not.toContain("conditional on landing");
  });
});
