import { describe, expect, it } from "vitest";
import {
  bestOfMs,
  CALIBRATION_ITERATIONS,
  calibrationWorkload,
  elapsedMs,
  CALIBRATION_REPEATS,
  IDLE_CALIBRATION_CEILING_MS,
  IDLE_GATE_CALIBRATION_ITERATIONS,
  IDLE_GATE_CALIBRATION_REPEATS,
  isIdleEnoughForWallClock,
  LOAD_TRACKING_CALIBRATION_ITERATIONS,
  MAX_IDLE_CALIBRATION_DISPERSION,
  measureCalibrationMs,
  measureIdleGateCalibration,
  MIN_LOAD_TRACKING_CALIBRATION_MS,
  pairedCost,
} from "./load-calibration.js";
import type { IdleGateCalibration } from "./load-calibration.js";

/**
 * A fake {@link Clock} that charges a scripted cost to each timed interval.
 *
 * `elapsedMs` reads the clock twice per interval, so each returned pair
 * differs by exactly the next scripted cost. This makes every assertion below
 * exact and impossible to fail from machine load -- which is the property this
 * whole module exists to give the rest of the suite.
 */
function scriptedClock(costs: readonly number[]): { now: () => number } {
  let t = 0;
  let reads = 0;
  let i = 0;
  return {
    now: () => {
      // Even reads open an interval, odd reads close it having charged a cost.
      if (reads++ % 2 === 1) t += costs[i++ % costs.length]!;
      return t;
    },
  };
}

/**
 * These tests assert the DETERMINISTIC properties of the helpers -- ordering,
 * counting, gating, monotonicity -- and never a wall-clock threshold. A module
 * whose whole purpose is to keep load-sensitive assertions out of the
 * correctness suite must not smuggle one back in via its own tests (P0.96).
 */
describe("calibrationWorkload (P0.96)", () => {
  it("is deterministic: the same iteration count gives bit-identical results across calls", () => {
    expect(calibrationWorkload(1000)).toBe(calibrationWorkload(1000));
  });

  it("returns a finite, strictly increasing total as iterations grow, so it cannot be optimised to a constant", () => {
    const small = calibrationWorkload(100);
    const large = calibrationWorkload(1000);

    expect(Number.isFinite(small)).toBe(true);
    expect(Number.isFinite(large)).toBe(true);
    expect(large).toBeGreaterThan(small);
  });

  it("does no work for a zero iteration count", () => {
    expect(calibrationWorkload(0)).toBe(0);
  });
});

describe("elapsedMs (P0.96)", () => {
  it("runs the callback exactly once and returns a finite non-negative duration", () => {
    let calls = 0;
    const ms = elapsedMs(() => {
      calls++;
    });

    expect(calls).toBe(1);
    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });
});

describe("bestOfMs (P0.96)", () => {
  it("runs warmups and trials the exact number of times asked, so a caller can reason about total cost", () => {
    let calls = 0;
    bestOfMs(
      () => {
        calls++;
      },
      15,
      20,
    );

    expect(calls).toBe(35);
  });

  it("returns the MINIMUM across trials, not the last or the mean -- the least-preempted sample is the point", () => {
    // A DETERMINISTIC fake clock, charging a scripted cost per trial. An
    // earlier version of this test used real workloads and a millisecond
    // slack term, and the control -- rewriting bestOfMs to return the LAST
    // trial -- passed it, because the slack swamped the difference. That is
    // why the clock is injected: the assertion below is exact, and the same
    // control now fails it.
    const costs = [40, 40, 3, 40, 40];
    const { now } = scriptedClock(costs);

    expect(bestOfMs(() => {}, costs.length, 0, now)).toBe(3);
  });

  it("is unmoved by where the cheap trial falls in the series", () => {
    expect(bestOfMs(() => {}, 4, 0, scriptedClock([7, 9, 9, 9]).now)).toBe(7);
    expect(bestOfMs(() => {}, 4, 0, scriptedClock([9, 9, 9, 7]).now)).toBe(7);
  });

  it("charges nothing for warmups: they run before the clock is read at all", () => {
    // Discriminating against an implementation that timed the warmups too.
    // The script is longer than the total number of intervals either
    // implementation consumes, so it never cycles: if the four warmups were
    // timed they would eat 2, 60, 60, 99 and the three trials would see only
    // 99s, giving 99 instead of 2. An earlier version of this test used a
    // three-entry script that DID cycle, and the control passed it.
    const { now } = scriptedClock([2, 60, 60, 99, 99, 99, 99]);
    let calls = 0;
    const best = bestOfMs(
      () => {
        calls++;
      },
      3,
      4,
      now,
    );

    expect(calls).toBe(7);
    expect(best).toBe(2);
  });

  it("with zero warmups still runs every trial", () => {
    let calls = 0;
    bestOfMs(
      () => {
        calls++;
      },
      3,
      0,
    );

    expect(calls).toBe(3);
  });
});

describe("measureCalibrationMs (P0.96)", () => {
  it("returns a finite positive duration on any machine", () => {
    const ms = measureCalibrationMs(10_000, 3);

    expect(Number.isFinite(ms)).toBe(true);
    expect(ms).toBeGreaterThanOrEqual(0);
  });

  it("scales with the work asked of it: a 20x larger workload does not come back cheaper", () => {
    // The load-invariance argument rests on the calibration tracking real
    // machine cost. If it did not scale with the work, a ratio against it
    // would be meaningless. Asserted as an inequality with slack rather than
    // a factor, because the factor itself is load-sensitive and this test
    // must not be.
    const small = measureCalibrationMs(10_000, 5);
    const large = measureCalibrationMs(200_000, 5);

    expect(large).toBeGreaterThanOrEqual(small);
  });

  it("uses the default iteration count and repeat count when not told otherwise", () => {
    expect(CALIBRATION_ITERATIONS).toBeGreaterThan(0);
    expect(Number.isFinite(measureCalibrationMs())).toBe(true);
  });
});

/**
 * A scripted calibration. Every case below builds one of these rather than
 * measuring, for the same reason the rest of this file does: a module that
 * exists to keep load-sensitive assertions out of the correctness suite must
 * not need one in its own tests (P0.96).
 */
function calibration(medianMs: number, minMs: number, meanMs = medianMs): IdleGateCalibration {
  return { medianMs, minMs, meanMs, dispersion: meanMs / minMs };
}

describe("isIdleEnoughForWallClock (P0.96, both arms P0.149)", () => {
  it("admits a calibration at or below the slow-machine ceiling and rejects one above it", () => {
    const flat = (medianMs: number) => calibration(medianMs, medianMs);
    expect(isIdleEnoughForWallClock(flat(IDLE_CALIBRATION_CEILING_MS - 0.001))).toBe(true);
    expect(isIdleEnoughForWallClock(flat(IDLE_CALIBRATION_CEILING_MS))).toBe(true);
    expect(isIdleEnoughForWallClock(flat(IDLE_CALIBRATION_CEILING_MS + 0.001))).toBe(false);
  });

  it("admits a dispersion at or below the busy-machine limit and rejects one above it", () => {
    const atDispersion = (d: number) => calibration(10 * d, 10);
    expect(isIdleEnoughForWallClock(atDispersion(MAX_IDLE_CALIBRATION_DISPERSION - 0.001))).toBe(
      true,
    );
    expect(isIdleEnoughForWallClock(atDispersion(MAX_IDLE_CALIBRATION_DISPERSION))).toBe(true);
    expect(isIdleEnoughForWallClock(atDispersion(MAX_IDLE_CALIBRATION_DISPERSION + 0.001))).toBe(
      false,
    );
  });

  it("closes on a fast but contended machine, which is the case P0.149 exists to fix", () => {
    // THE DISCRIMINATING CASE FOR THE NEW ARM, and it is discriminating
    // because the OTHER arm passes it comfortably. A median of 15 ms is a
    // third of the 48 ms ceiling, so the pre-P0.149 gate -- a cost test alone
    // -- admitted exactly this machine and held it to the blueprint figure.
    // These are the measured 8-way-sustained-load figures, not invented ones.
    const contended = calibration(15.1, 10.9, 15.6);
    expect(contended.medianMs).toBeLessThan(IDLE_CALIBRATION_CEILING_MS);
    expect(isIdleEnoughForWallClock(contended)).toBe(false);
  });

  it("stays open on a slow machine that is idle, so being slow alone does not lose the figure", () => {
    // The converse, and it is the reason the busy arm had to be dimensionless.
    // A machine 4x slower than the development container, with nothing else
    // running, has a large cost and a flat dispersion. It is still held to the
    // figure; only the ~5x ceiling excuses it.
    const slowButIdle = calibration(38.4, 38.0);
    expect(slowButIdle.dispersion).toBeLessThan(MAX_IDLE_CALIBRATION_DISPERSION);
    expect(isIdleEnoughForWallClock(slowButIdle)).toBe(true);
  });

  it("closes when either arm alone says so, never needing both", () => {
    // Pins the OR rather than an AND: each row fails exactly one arm.
    const slowOnly = calibration(IDLE_CALIBRATION_CEILING_MS + 1, IDLE_CALIBRATION_CEILING_MS + 1);
    const busyOnly = calibration(10 * (MAX_IDLE_CALIBRATION_DISPERSION + 0.05), 10);
    expect(slowOnly.dispersion).toBeLessThanOrEqual(MAX_IDLE_CALIBRATION_DISPERSION);
    expect(busyOnly.medianMs).toBeLessThan(IDLE_CALIBRATION_CEILING_MS);
    expect(isIdleEnoughForWallClock(slowOnly)).toBe(false);
    expect(isIdleEnoughForWallClock(busyOnly)).toBe(false);
  });

  it("gates on the calibration alone and never on the measurement it guards", () => {
    // THE DISCRIMINATING TEST, CARRIED THROUGH P0.149'S SIGNATURE CHANGE. This
    // is what stops the gate being a way to hide a regression: the function
    // has no way to see the measured value, so code that got slower cannot
    // cause its own check to be skipped. A signature taking the measurement
    // would fail to compile here, and the shape assertion pins that the only
    // inputs are the calibration and its two limits.
    expect(isIdleEnoughForWallClock.length).toBeLessThanOrEqual(2);
    expect(Object.keys(calibration(1, 1)).sort()).toEqual([
      "dispersion",
      "meanMs",
      "medianMs",
      "minMs",
    ]);
    expect(isIdleEnoughForWallClock(calibration(0.5, 0.5), 3)).toBe(true);
    expect(isIdleEnoughForWallClock(calibration(9_999, 9_999), 3)).toBe(false);
  });

  it("honours explicit limits over the defaults", () => {
    expect(isIdleEnoughForWallClock(calibration(5, 5), 10)).toBe(true);
    expect(isIdleEnoughForWallClock(calibration(5, 5), 1)).toBe(false);
    expect(isIdleEnoughForWallClock(calibration(12, 10), 100, 1.5)).toBe(true);
    expect(isIdleEnoughForWallClock(calibration(12, 10), 100, 1.1)).toBe(false);
  });
});

describe("measureIdleGateCalibration (P0.149)", () => {
  it("reports the median, the minimum and their ratio from one scripted series", () => {
    // Driven by the file's own scripted clock, so this asserts the ARITHMETIC
    // of the summary and never a wall-clock threshold -- the rule the whole
    // file follows. Costs 5, 1, 3, 9, 7 ms: median 5, min 1, dispersion 5.
    const costs = [5, 1, 3, 9, 7];
    const c = measureIdleGateCalibration(1, costs.length, scriptedClock(costs).now);
    expect(c.medianMs).toBe(5);
    expect(c.minMs).toBe(1);
    expect(c.meanMs).toBe(5);
    expect(c.dispersion).toBe(5);
  });

  it("divides the MEAN by the minimum, not the median, which is what separates load", () => {
    // THE DISCRIMINATING CASE FOR THE STATISTIC ITSELF. One long preempted
    // sample among many short ones is the load signature: it moves the mean
    // and leaves the median alone. Costs 2,2,2,2,20 -> median 2, mean 5.6,
    // min 2. A median/min pairing reports 1.0 here and sees nothing.
    const c = measureIdleGateCalibration(1, 5, scriptedClock([2, 2, 2, 2, 20]).now);
    expect(c.medianMs).toBe(2);
    expect(c.minMs).toBe(2);
    expect(c.meanMs).toBeCloseTo(5.6, 10);
    expect(c.dispersion).toBeCloseTo(2.8, 10);
    expect(c.medianMs / c.minMs).toBe(1);
    expect(isIdleEnoughForWallClock(c)).toBe(false);
  });

  it("reports a dispersion of exactly 1 when every sample costs the same", () => {
    // The idle limit of the statistic, and the reason the busy arm can sit as
    // close to 1 as 1.09: with no preemption there is nothing to disperse.
    const c = measureIdleGateCalibration(1, 6, scriptedClock([4]).now);
    expect(c.medianMs).toBe(4);
    expect(c.minMs).toBe(4);
    expect(c.meanMs).toBe(4);
    expect(c.dispersion).toBe(1);
  });

  it("samples a workload long enough to be preempted, which is what the old gate did not", () => {
    // Not a timing assertion: it pins the SIZE, which is the property P0.147
    // and P0.148 measured as load-bearing. A gate calibrated at
    // CALIBRATION_ITERATIONS sits below both preemption boundaries and cannot
    // report load at all, which was the whole of P0.149.
    expect(IDLE_GATE_CALIBRATION_ITERATIONS).toBe(LOAD_TRACKING_CALIBRATION_ITERATIONS);
    expect(IDLE_GATE_CALIBRATION_ITERATIONS).toBeGreaterThan(CALIBRATION_ITERATIONS);
    expect(IDLE_GATE_CALIBRATION_REPEATS).toBeGreaterThanOrEqual(CALIBRATION_REPEATS);
  });
});

/**
 * P0.147. These assert the ARITHMETIC of the pairing against scripted series,
 * never a wall-clock threshold -- same rule as the rest of this file. The
 * measured evidence that a sub-timeslice calibration cannot track load lives in
 * {@link LOAD_TRACKING_CALIBRATION_ITERATIONS}'s doc table and in the ROADMAP
 * notes; it is not re-measured here, because re-measuring it would be exactly
 * the load-sensitive assertion this module exists to avoid.
 */
describe("pairedCost (P0.147)", () => {
  it("divides the median sample by the median calibration, not by the minimum", () => {
    // Minimum calibration is 1; median is 4. A min-based pairing would report
    // 20, which is the defect P0.147 was filed for.
    const cost = pairedCost([10, 20, 30], [1, 4, 7]);

    expect(cost.medianMs).toBe(20);
    expect(cost.calibrationMs).toBe(4);
    expect(cost.costInCalibrations).toBe(5);
  });

  it("is unchanged when load stretches both series by the same factor", () => {
    // This is the whole claim: contention that multiplies both sides cancels.
    const samples = [10, 20, 30, 40, 50];
    const calibrations = [2, 3, 4, 5, 6];
    const idle = pairedCost(samples, calibrations);
    const loaded = pairedCost(
      samples.map((s) => s * 2.4),
      calibrations.map((c) => c * 2.4),
    );

    expect(loaded.costInCalibrations).toBeCloseTo(idle.costInCalibrations, 12);
  });

  it("still rises when the samples get slower and the calibration does not", () => {
    // The regression this assertion has to keep catching: slower code does not
    // move an arithmetic workload, so the ratio must move.
    const calibrations = [4, 4, 4];
    const before = pairedCost([10, 20, 30], calibrations);
    const after = pairedCost([20, 40, 60], calibrations);

    expect(after.costInCalibrations).toBe(2 * before.costInCalibrations);
  });

  it("is robust to a single preempted sample on either side", () => {
    // A median tolerates one outlier per side; a mean would not.
    const clean = pairedCost([10, 10, 10, 10, 10], [4, 4, 4, 4, 4]);
    const spiked = pairedCost([10, 10, 10, 10, 900], [4, 4, 4, 4, 400]);

    expect(spiked.costInCalibrations).toBe(clean.costInCalibrations);
  });

  it("reports it could not track load when the calibration is below the floor", () => {
    const tooShort = pairedCost([10, 20, 30], [0.6, 0.65, 0.7]);

    expect(tooShort.tracksLoad).toBe(false);
    // The ratio is still computed -- the caller decides what to do with it --
    // but the flag says it means nothing.
    expect(tooShort.costInCalibrations).toBeCloseTo(20 / 0.65, 12);
  });

  it("tracks load exactly at the floor, and not just above it", () => {
    expect(pairedCost([10], [MIN_LOAD_TRACKING_CALIBRATION_MS]).tracksLoad).toBe(true);
    expect(pairedCost([10], [MIN_LOAD_TRACKING_CALIBRATION_MS - 1e-9]).tracksLoad).toBe(false);
  });

  it("honours a caller-supplied floor", () => {
    expect(pairedCost([10], [5], 4).tracksLoad).toBe(true);
    expect(pairedCost([10], [5], 6).tracksLoad).toBe(false);
  });

  it("gates on the calibration alone, never on the measurement it guards", () => {
    // The rule this module's header states for isIdleEnoughForWallClock, and
    // the reason this flag cannot hide a regression. Below-floor calibrations
    // must report false however fast OR slow the samples are, so a hundredfold
    // slower measurement can neither opt itself out of the gate nor buy its
    // way past it.
    const belowFloor = [0.5, 0.5, 0.5];
    const aboveFloor = [4, 4, 4];

    expect(pairedCost([10, 20, 30], belowFloor).tracksLoad).toBe(false);
    expect(pairedCost([1000, 2000, 3000], belowFloor).tracksLoad).toBe(false);
    expect(pairedCost([10, 20, 30], aboveFloor).tracksLoad).toBe(true);
    expect(pairedCost([1000, 2000, 3000], aboveFloor).tracksLoad).toBe(true);
  });

  it("refuses series that did not span the same window", () => {
    // Unequal lengths mean the calibrations were not interleaved with the
    // samples, which is the property the invariance rests on.
    expect(() => pairedCost([1, 2, 3], [1, 2])).toThrow(RangeError);
    expect(() => pairedCost([], [])).toThrow(RangeError);
  });

  it("sizes the load-tracking workload well clear of the floor it must pass", () => {
    // A structural check, not a timing one: the larger workload exists so that
    // tracksLoad can be true, so it must be much bigger than the size measured
    // NOT to track load.
    expect(LOAD_TRACKING_CALIBRATION_ITERATIONS).toBeGreaterThan(10 * CALIBRATION_ITERATIONS);
    expect(MIN_LOAD_TRACKING_CALIBRATION_MS).toBeGreaterThan(0);
  });
});
